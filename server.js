require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const manifest = require("./manifest");
const { searchAllSubtitles, downloadSubtitleText } = require("./providers");
const { parseSrt, cleanCues, cuesToVtt } = require("./srtHelper");
const { translateCues } = require("./translator");
const { extractEmbeddedSubtitle, extractAudioChunk } = require("./embeddedExtractor");
const { audioToSubtitleGemini, sanitizeGeminiModel } = require("./geminiStream");
const cache = require("./cache");

const app = express();
const PORT = process.env.PORT || 7000;

// Enable reverse proxy trust for correct protocol (https) behind Traefik
app.set("trust proxy", true);

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// In-Flight Translation Promise Deduplication Map
// Prevents duplicate concurrent translation jobs when video player seeks or opens parallel connections
const inFlightJobs = new Map();

// Helper to determine accurate public protocol behind reverse proxy
function getPublicProtocol(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (forwardedProto) {
    return forwardedProto.split(",")[0].trim();
  }
  return req.secure || req.protocol === "https" ? "https" : "http";
}

// Helper to decode Base64 / URL-safe Base64 safely
function safeBase64Decode(str) {
  if (!str || typeof str !== "string") return null;
  try {
    let normalized = str.replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4 !== 0) {
      normalized += "=";
    }
    return Buffer.from(normalized, "base64").toString("utf-8");
  } catch (e) {
    return null;
  }
}

// Helper to parse user configuration from URL
function parseConfig(configStr) {
  const defaults = {
    lang: "en",
    engine: "google",
    apiKey: "",
    model: "",
    subdlKey: "",
    osKey: "",
    subsourceKey: ""
  };

  if (!configStr || typeof configStr !== "string") return defaults;

  // 1. Plain language string e.g. "ms", "en", "es", "pt-br", "zh-cn"
  if (/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,4})?$/.test(configStr)) {
    return { ...defaults, lang: configStr.toLowerCase() };
  }

  // 2. Query param string e.g. "lang=ms&engine=gemini"
  if (configStr.includes("=") && (configStr.includes("lang") || configStr.includes("engine"))) {
    try {
      const params = new URLSearchParams(configStr);
      return {
        lang: params.get("lang") || defaults.lang,
        engine: params.get("engine") || defaults.engine,
        apiKey: params.get("apiKey") || "",
        model: params.get("model") || "",
        subdlKey: params.get("subdlKey") || "",
        osKey: params.get("osKey") || "",
        subsourceKey: params.get("subsourceKey") || ""
      };
    } catch (e) {}
  }

  // 3. Base64 or URL-Safe Base64 JSON
  const decoded = safeBase64Decode(configStr);
  if (decoded) {
    try {
      const parsed = JSON.parse(decoded);
      return {
        lang: parsed.lang || defaults.lang,
        engine: parsed.engine || defaults.engine,
        apiKey: parsed.apiKey || "",
        model: parsed.model || "",
        subdlKey: parsed.subdlKey || "",
        osKey: parsed.osKey || "",
        subsourceKey: parsed.subsourceKey || ""
      };
    } catch (e) {}
  }

  return defaults;
}

// 1. Web Configuration Page
app.get(["/", "/configure", "/:config/configure", "/:config"], (req, res, next) => {
  if (req.path.endsWith(".json") || req.path.startsWith("/api") || req.path.startsWith("/subtitles")) {
    return next();
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 2. Manifest Endpoint
app.get(["/manifest.json", "/:config/manifest.json"], (req, res) => {
  const { lang, engine, model } = parseConfig(req.params.config);
  const modelTag = model ? ` (${model})` : "";

  const customManifest = {
    ...manifest,
    name: `nifael AI subtitle [${lang.toUpperCase()} - ${engine.toUpperCase()}${modelTag}]`,
    description: `AI-powered subtitle translation (${engine.toUpperCase()}${modelTag}) from OpenSubtitles, SubDL, and SubSource to ${lang.toUpperCase()}.`
  };

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json(customManifest);
});

// ISO 639-1 (2-letter) to ISO 639-2 (3-letter) mapping for Stremio player compatibility
const ISO_639_MAP = {
  ms: "may", // Malay
  id: "ind", // Indonesian
  en: "eng", // English
  es: "spa", // Spanish
  fr: "fre", // French
  de: "ger", // German
  it: "ita", // Italian
  pt: "por", // Portuguese
  ru: "rus", // Russian
  ar: "ara", // Arabic
  ja: "jpn", // Japanese
  ko: "kor", // Korean
  zh: "chi", // Chinese
  hi: "hin", // Hindi
  th: "tha", // Thai
  vi: "vie", // Vietnamese
  tr: "tur", // Turkish
  pl: "pol", // Polish
  nl: "dut", // Dutch
  sv: "swe", // Swedish
  da: "dan", // Danish
  fi: "fin", // Finnish
  no: "nor", // Norwegian
  cs: "cze", // Czech
  el: "gre", // Greek
  he: "heb", // Hebrew
  ro: "rum", // Romanian
  hu: "hun", // Hungarian
  bg: "bul", // Bulgarian
  uk: "ukr", // Ukrainian
  fa: "per", // Persian
  ur: "urd", // Urdu
  bn: "ben", // Bengali
  ta: "tam", // Tamil
  te: "tel", // Telugu
  mr: "mar", // Marathi
  gu: "guj", // Gujarati
  kn: "kan", // Kannada
  ml: "mal", // Malayalam
  pa: "pan", // Punjabi
  tl: "tgl", // Tagalog
  fil: "fil", // Filipino
  sq: "alb", // Albanian
  hr: "hrv", // Croatian
  sr: "srp", // Serbian
  sk: "slo", // Slovak
  sl: "slv", // Slovenian
  et: "est", // Estonian
  lv: "lav", // Latvian
  lt: "lit", // Lithuanian
  ka: "geo", // Georgian
  hy: "arm", // Armenian
  az: "aze", // Azerbaijani
  kk: "kaz", // Kazakh
  uz: "uzb", // Uzbek
  mn: "mon", // Mongolian
  my: "bur", // Burmese
  km: "khm", // Khmer
  lo: "lao", // Lao
  ne: "nep", // Nepali
  si: "sin", // Sinhala
  sw: "swa", // Swahili
  af: "afr", // Afrikaans
  is: "ice", // Icelandic
  ga: "gle", // Irish
  cy: "wel", // Welsh
  eu: "baq", // Basque
  ca: "cat", // Catalan
  gl: "glg", // Galician
  bs: "bos", // Bosnian
  mk: "mac", // Macedonian
  mt: "mlt"  // Maltese
};

function mapToStremioLang(code) {
  if (!code || typeof code !== "string") return "eng";
  const clean = code.trim().toLowerCase().split("-")[0];
  if (clean.length === 3) return clean;
  return ISO_639_MAP[clean] || clean;
}

// 3. Subtitles Discovery Endpoint
// =========================================================================================
// STREMIO SUBTITLE ADDON PROTOCOL CONSTRAINTS (Embedded vs External Subtitles):
// - Stremio's standard Subtitle Addon Protocol sends only the media ID (e.g. IMDb ID 'tt37287335',
//   season, episode) to this discovery endpoint, with NO video stream URL or media file attached.
// - Therefore, a standalone subtitle addon cannot extract embedded/internal subtitle tracks
//   during a standard discovery query because the video stream itself is unknown to the addon.
// - Standalone subtitle addons instead aggregate and match external subtitles from databases
//   (OpenSubtitles, SubDL, SubSource) based on the media ID.
// - To extract and translate embedded MKV/MP4 subtitle tracks directly from remote video streams,
//   Stream Addons (e.g. AIOStreams, Debrid proxies) can call the /api/translate-embedded endpoint.
// =========================================================================================
app.get(["/subtitles/:type/:id.json", "/:config/subtitles/:type/:id.json"], async (req, res) => {
  try {
    const { type, id } = req.params;
    const { lang, engine, apiKey, model, subdlKey, osKey, subsourceKey } = parseConfig(req.params.config);

    const idParts = (id || "").split(":");
    const imdbId = idParts[0];
    const season = idParts[1] ? parseInt(idParts[1], 10) : null;
    const episode = idParts[2] ? parseInt(idParts[2], 10) : null;

    console.log(`\n[nifael AI] Subtitle query -> Type: ${type} | IMDb: ${imdbId} | S:${season || 0} E:${episode || 0} | Target: ${lang} | Engine: ${engine}`);

    const availableSubs = await searchAllSubtitles(imdbId, season, episode, { osKey, subdlKey, subsourceKey }, type);

    const host = req.get("host") || "aisubtitletranslation.nifael06.site";
    const protocol = getPublicProtocol(req);

    // Deduplicate and return ALL available subtitles at maximum
    const seenUrls = new Set();
    const uniqueSubs = [];
    for (const sub of availableSubs) {
      if (sub && sub.downloadUrl && !seenUrls.has(sub.downloadUrl)) {
        seenUrls.add(sub.downloadUrl);
        uniqueSubs.push(sub);
      }
    }

    const stremioLang = mapToStremioLang(lang);
    const engineTag = engine === "gemini_live"
      ? "GEMINI LIVE ⚡"
      : (model ? `${engine.toUpperCase()}:${model}` : engine.toUpperCase());

    const stremioSubtitles = uniqueSubs.map((sub, idx) => {
      let renderUrl = `${protocol}://${host}/api/render-sub?targetLang=${lang}&engine=${engine}&subUrl=${encodeURIComponent(sub.downloadUrl)}`;
      if (apiKey) renderUrl += `&apiKey=${encodeURIComponent(apiKey)}`;
      if (model) renderUrl += `&model=${encodeURIComponent(model)}`;

      const displaySource = sub.source || "Sub";
      const fromLang = (sub.lang || "EN").toUpperCase();
      const toLang = lang.toUpperCase();
      const fileNameSnippet = (sub.fileName || "Subtitle").substring(0, 35);

      return {
        id: `nifael_${sub.source ? sub.source.toLowerCase() : "sub"}_${idx}`,
        url: renderUrl,
        lang: stremioLang,
        label: `[nifael AI: ${engineTag}] ${displaySource} (${fromLang} ➔ ${toLang}) - ${fileNameSnippet}`
      };
    });

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json({ subtitles: stremioSubtitles });
  } catch (error) {
    console.error("[nifael AI] Error handling subtitle request:", error.message);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json({ subtitles: [] });
  }
});

/**
 * Worker: Process subtitle download, parsing, cleaning, translation, and WebVTT generation
 */
async function processRenderSub({ lang, selectedEngine, selectedModel, apiKey, subUrl, cacheKey }) {
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  console.log(`[nifael AI] Downloading & translating subtitle to '${lang}' using [${selectedEngine.toUpperCase()}] from: ${subUrl}`);

  const rawSrt = await downloadSubtitleText(subUrl);
  if (!rawSrt) {
    throw new Error("Failed to download original subtitle file.");
  }

  // 1. Parse raw SRT/VTT into cues
  const rawCues = parseSrt(rawSrt);
  if (!rawCues || rawCues.length === 0) {
    throw new Error("Failed to parse subtitle cues.");
  }

  // 2. Clean out ads, watermarks, and promotional links
  const cues = cleanCues(rawCues);

  // 3. Translate dialogue cues
  const translationResult = await translateCues(cues, lang, selectedEngine, apiKey, selectedModel);
  let translatedCues = translationResult.cues;

  // If quota was exceeded, inject a warning subtitle cue at the beginning
  if (translationResult.quotaExceeded) {
    const engineName = translationResult.engine || selectedEngine.toUpperCase();
    console.warn(`[nifael AI] ${engineName} quota exceeded — injecting warning cue and serving fallback translation`);

    const warningCue = {
      id: "1",
      startTime: "00:00:01,000",
      endTime: "00:00:15,000",
      text: `⚠️ [nifael AI Warning]: Your ${engineName} API key quota was exceeded! Showing Free Translation.`
    };
    translatedCues = [warningCue, ...translatedCues].map((cue, idx) => ({
      ...cue,
      id: String(idx + 1)
    }));
  }

  // 4. Build standard WebVTT with strict chronological sorting
  const vttContent = cuesToVtt(translatedCues);
  cache.set(cacheKey, vttContent);
  return vttContent;
}

// 4. Subtitle Render & Translation Endpoint (With In-Flight Deduplication & Seeking Headers)
app.get("/api/render-sub", async (req, res) => {
  try {
    const { targetLang, subUrl, engine, apiKey, model } = req.query;

    if (!subUrl) {
      return res.status(400).send("Missing subUrl query parameter");
    }

    const lang = targetLang || "en";
    const selectedEngine = engine || "google";
    const selectedModel = model || "";
    const cacheKey = `sub_${selectedEngine}_${selectedModel || "def"}_${lang}_${subUrl}`;

    // 1. Return cached WebVTT if available (instant response for seeking)
    const cachedVtt = cache.get(cacheKey);
    if (cachedVtt) {
      console.log(`[nifael AI] ⚡ Cache hit: ${cacheKey.substring(0, 60)}...`);
      res.setHeader("Content-Type", "text/vtt; charset=utf-8");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      res.setHeader("Content-Length", Buffer.byteLength(cachedVtt, "utf-8"));
      return res.send(cachedVtt);
    }

    // 2. In-Flight Translation Promise Deduplication
    let jobPromise = inFlightJobs.get(cacheKey);
    if (jobPromise) {
      console.log(`[nifael AI] 🔗 Attaching to active in-flight translation job: ${cacheKey.substring(0, 60)}...`);
    } else {
      jobPromise = processRenderSub({ lang, selectedEngine, selectedModel, apiKey, subUrl, cacheKey })
        .finally(() => {
          inFlightJobs.delete(cacheKey);
        });
      inFlightJobs.set(cacheKey, jobPromise);
    }

    const vttContent = await jobPromise;

    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.setHeader("Content-Length", Buffer.byteLength(vttContent, "utf-8"));
    return res.send(vttContent);
  } catch (error) {
    console.error("[nifael AI] Translation render error:", error.message);
    res.status(500).send("Internal Server Error while rendering subtitle.");
  }
});

/**
 * Worker: Process embedded subtitle extraction, parsing, cleaning, translation, and WebVTT generation
 */
async function processEmbeddedSub({ lang, selectedEngine, selectedModel, apiKey, safeTrackIndex, videoUrl, cacheKey }) {
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  console.log(`[nifael AI] Extracting & translating embedded subtitle track #${safeTrackIndex} to '${lang}' using [${selectedEngine.toUpperCase()}] from: ${videoUrl}`);

  // 1. Extract raw SRT directly from remote video stream using ffmpeg
  const rawSrt = await extractEmbeddedSubtitle(videoUrl, safeTrackIndex);
  if (!rawSrt) {
    throw new Error("Failed to extract embedded subtitle track from stream.");
  }

  // 2. Parse raw SRT into cues
  const rawCues = parseSrt(rawSrt);
  if (!rawCues || rawCues.length === 0) {
    throw new Error("Failed to parse extracted subtitle cues.");
  }

  // 3. Clean out ads, watermarks, and promotional links
  const cues = cleanCues(rawCues);

  // 4. Translate dialogue cues
  const translationResult = await translateCues(cues, lang, selectedEngine, apiKey, selectedModel);
  let translatedCues = translationResult.cues;

  // If quota was exceeded, inject a warning subtitle cue at the beginning
  if (translationResult.quotaExceeded) {
    const engineName = translationResult.engine || selectedEngine.toUpperCase();
    console.warn(`[nifael AI] ${engineName} quota exceeded — injecting warning cue and serving fallback translation`);

    const warningCue = {
      id: "1",
      startTime: "00:00:01,000",
      endTime: "00:00:15,000",
      text: `⚠️ [nifael AI Warning]: Your ${engineName} API key quota was exceeded! Showing Free Translation.`
    };
    translatedCues = [warningCue, ...translatedCues].map((cue, idx) => ({
      ...cue,
      id: String(idx + 1)
    }));
  }

  // 5. Build standard WebVTT with strict chronological sorting
  const vttContent = cuesToVtt(translatedCues);
  cache.set(cacheKey, vttContent);
  return vttContent;
}

// 5. Embedded Subtitle Extraction & Translation Endpoint (With In-Flight Deduplication & Seeking Headers)
app.get("/api/translate-embedded", async (req, res) => {
  try {
    const { videoUrl, targetLang, trackIndex, engine, apiKey, model } = req.query;

    if (!videoUrl) {
      return res.status(400).send("Missing videoUrl query parameter");
    }

    const lang = targetLang || "en";
    const selectedEngine = engine || "google";
    const selectedModel = model || "";
    const selectedTrack = trackIndex !== undefined ? parseInt(trackIndex, 10) : 0;
    const safeTrackIndex = isNaN(selectedTrack) ? 0 : Math.max(0, selectedTrack);
    const cacheKey = `embedded_${selectedEngine}_${selectedModel || "def"}_${lang}_${safeTrackIndex}_${videoUrl}`;

    // Return cached WebVTT if available (instant response)
    const cachedVtt = cache.get(cacheKey);
    if (cachedVtt) {
      console.log(`[nifael AI] ⚡ Cache hit (embedded): ${cacheKey.substring(0, 60)}...`);
      res.setHeader("Content-Type", "text/vtt; charset=utf-8");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      res.setHeader("Content-Length", Buffer.byteLength(cachedVtt, "utf-8"));
      return res.send(cachedVtt);
    }

    let jobPromise = inFlightJobs.get(cacheKey);
    if (jobPromise) {
      console.log(`[nifael AI] 🔗 Attaching to active in-flight embedded extraction job: ${cacheKey.substring(0, 60)}...`);
    } else {
      jobPromise = processEmbeddedSub({ lang, selectedEngine, selectedModel, apiKey, safeTrackIndex, videoUrl, cacheKey })
        .finally(() => {
          inFlightJobs.delete(cacheKey);
        });
      inFlightJobs.set(cacheKey, jobPromise);
    }

    const vttContent = await jobPromise;

    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.setHeader("Content-Length", Buffer.byteLength(vttContent, "utf-8"));
    return res.send(vttContent);
  } catch (error) {
    console.error("[nifael AI] Embedded translation render error:", error.message);
    res.status(500).send("Internal Server Error while translating embedded subtitle.");
  }
});

/**
 * Worker: Process live audio extraction, transcription, and translation via Gemini Multimodal AI
 */
async function processLiveAudioSub({ videoUrl, lang, apiKey, model, startTime, duration, cacheKey }) {
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  console.log(`[nifael AI] 🎙️ Extracting & transcribing audio from: ${videoUrl} (Start: ${startTime}, Dur: ${duration}s) -> [${lang.toUpperCase()}]`);

  // 1. Extract lightweight MP3 audio stream directly from remote URL using ffmpeg
  const audioBase64 = await extractAudioChunk(videoUrl, startTime, duration);
  if (!audioBase64) {
    throw new Error("Failed to extract audio stream from video.");
  }

  // 2. Transcribe & translate audio directly via Gemini Multimodal AI
  const rawSrt = await audioToSubtitleGemini(audioBase64, lang, apiKey, model);
  if (!rawSrt) {
    throw new Error("Failed to transcribe audio to subtitle.");
  }

  // 3. Parse and clean generated subtitle cues
  const rawCues = parseSrt(rawSrt);
  const cleanedCues = cleanCues(rawCues);

  // 4. Format into standard WebVTT with strict chronological sorting
  const vttContent = cuesToVtt(cleanedCues);
  cache.set(cacheKey, vttContent);
  return vttContent;
}

// 6. Live Audio-to-Subtitle Multimodal Transcription Endpoint
app.get("/api/live-audio-sub", async (req, res) => {
  try {
    const { videoUrl, targetLang, apiKey, model, startTime, duration } = req.query;

    if (!videoUrl) {
      return res.status(400).send("Missing videoUrl query parameter");
    }

    const lang = targetLang || "en";
    const selectedModel = model || "";
    const safeStart = startTime || "00:00:00";
    const safeDur = duration ? parseInt(duration, 10) : 600;
    const cacheKey = `audio_sub_${selectedModel || "def"}_${lang}_${safeStart}_${safeDur}_${videoUrl}`;

    const cachedVtt = cache.get(cacheKey);
    if (cachedVtt) {
      console.log(`[nifael AI] ⚡ Cache hit (audio-sub): ${cacheKey.substring(0, 60)}...`);
      res.setHeader("Content-Type", "text/vtt; charset=utf-8");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      res.setHeader("Content-Length", Buffer.byteLength(cachedVtt, "utf-8"));
      return res.send(cachedVtt);
    }

    let jobPromise = inFlightJobs.get(cacheKey);
    if (jobPromise) {
      console.log(`[nifael AI] 🔗 Attaching to active in-flight audio transcription job: ${cacheKey.substring(0, 60)}...`);
    } else {
      jobPromise = processLiveAudioSub({ videoUrl, lang, apiKey, model: selectedModel, startTime: safeStart, duration: safeDur, cacheKey })
        .finally(() => {
          inFlightJobs.delete(cacheKey);
        });
      inFlightJobs.set(cacheKey, jobPromise);
    }

    const vttContent = await jobPromise;

    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.setHeader("Content-Length", Buffer.byteLength(vttContent, "utf-8"));
    return res.send(vttContent);
  } catch (error) {
    console.error("[nifael AI] Live audio-to-sub error:", error.message);
    res.status(500).send("Internal Server Error while transcribing audio to subtitle.");
  }
});

// 7. API Key & Provider Verification Endpoint
app.post("/api/verify-key", async (req, res) => {
  const { provider, apiKey, model } = req.body || {};

  if (!apiKey || !apiKey.trim()) {
    return res.status(400).json({ success: false, message: "API key is required" });
  }

  const key = apiKey.trim();

  try {
    if (provider === "gemini" || provider === "gemini_live") {
      let selectedModel = sanitizeGeminiModel(model);
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${key}`;
        const response = await axios.post(
          url,
          {
            contents: [{ parts: [{ text: "Translate: Hello" }] }]
          },
          { timeout: 8000 }
        );
        if (response.data && response.data.candidates) {
          return res.json({ success: true, message: `Valid & Working (${selectedModel})` });
        }
        return res.json({ success: true, message: "Valid & Working" });
      } catch (gemErr) {
        // If model failed or was deprecated, auto-fallback to gemini-3.5-flash-lite
        if (selectedModel !== "gemini-3.5-flash-lite" && (gemErr.response?.status === 404 || gemErr.response?.status === 400)) {
          selectedModel = "gemini-3.5-flash-lite";
          const retryUrl = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${key}`;
          const retryRes = await axios.post(
            retryUrl,
            { contents: [{ parts: [{ text: "Translate: Hello" }] }] },
            { timeout: 8000 }
          );
          if (retryRes.data && retryRes.data.candidates) {
            return res.json({ success: true, message: `Valid & Working (${selectedModel})` });
          }
        }
        throw gemErr;
      }
    } else if (provider === "openai") {
      const response = await axios.get("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 8000
      });
      if (response.data && response.data.data) {
        return res.json({ success: true, message: "Valid & Working" });
      }
    } else if (provider === "deepl") {
      const endpoint = key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
      const response = await axios.get(`${endpoint}/v2/usage`, {
        headers: { Authorization: `DeepL-Auth-Key ${key}` },
        timeout: 8000
      });
      if (response.data && typeof response.data.character_count !== "undefined") {
        const count = response.data.character_count.toLocaleString();
        const limit = response.data.character_limit ? response.data.character_limit.toLocaleString() : "unlimited";
        return res.json({ success: true, message: `Valid & Working (${count}/${limit} chars)` });
      }
    } else if (provider === "opensubtitles") {
      const response = await axios.get("https://api.opensubtitles.com/api/v1/infos/user", {
        headers: {
          "Api-Key": key,
          "User-Agent": "nifael AI subtitle v1.0.0"
        },
        timeout: 8000
      });
      if (response.data && response.data.data) {
        const user = response.data.data.username || "VIP User";
        return res.json({ success: true, message: `Valid & Working (User: ${user})` });
      }
    } else if (provider === "subdl") {
      const response = await axios.get(`https://api.subdl.com/api/v1/subtitles?api_key=${encodeURIComponent(key)}&imdb_id=tt0111161`, {
        timeout: 8000
      });
      if (response.data && response.data.status !== false && !response.data.error) {
        return res.json({ success: true, message: "Valid & Working" });
      } else {
        return res.json({ success: false, message: response.data.error || "Invalid SubDL API Key" });
      }
    } else if (provider === "subsource") {
      const response = await axios.get(`https://api.subsource.net/api/v1/subtitles/search?imdb=tt0111161&api_key=${encodeURIComponent(key)}`, {
        timeout: 8000
      });
      if (response.data && (response.data.success || response.data.subtitles || Array.isArray(response.data))) {
        return res.json({ success: true, message: "Valid & Working" });
      } else {
        return res.json({ success: false, message: response.data.message || "Invalid SubSource API Key" });
      }
    } else {
      return res.status(400).json({ success: false, message: `Unknown provider '${provider}'` });
    }

    return res.json({ success: true, message: "Valid & Working" });
  } catch (error) {
    let errorMsg = error.message;
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      if (status === 401 || status === 403) {
        errorMsg = data?.error?.message || data?.message || "Invalid API key or unauthorized access";
      } else if (status === 404) {
        errorMsg = data?.error?.message || data?.message || "Model or endpoint not found";
      } else if (status === 429) {
        errorMsg = "Rate limit or quota exceeded";
      } else {
        errorMsg = data?.error?.message || data?.message || `HTTP ${status}: ${error.message}`;
      }
    }
    return res.json({ success: false, message: errorMsg });
  }
});

const server = app.listen(PORT, () => {
  console.log(`=============================================`);
  console.log(` nifael AI subtitle is active and ready!`);
  console.log(` Port:       ${PORT}`);
  console.log(`=============================================`);
});

// Graceful shutdown handling
function gracefulShutdown(signal) {
  console.log(`[nifael AI] Received ${signal}, flushing cache and shutting down gracefully...`);
  cache.flush();
  inFlightJobs.clear();
  server.close(() => {
    console.log("[nifael AI] HTTP server closed cleanly.");
    process.exit(0);
  });
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
