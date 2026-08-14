require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const manifest = require("./manifest");
const { searchAllSubtitles, downloadSubtitleText } = require("./providers");
const { parseSrt, cleanCues, cuesToVtt } = require("./srtHelper");
const { translateCues } = require("./translator");
const cache = require("./cache");

const app = express();
const PORT = process.env.PORT || 7000;

// Enable reverse proxy trust for correct protocol (https) behind Traefik
app.set("trust proxy", true);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Helper to decode Base64 / URL-safe Base64 safely
function safeBase64Decode(str) {
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
    lang: "ms",
    engine: "google",
    apiKey: "",
    model: "",
    subdlKey: "",
    osKey: "",
    subsourceKey: ""
  };

  if (!configStr) return defaults;

  // 1. Plain language string e.g. "ms", "en", "es"
  if (/^[a-zA-Z]{2,3}$/.test(configStr)) {
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
app.get(["/", "/configure"], (req, res) => {
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

  res.json(customManifest);
});

// 3. Subtitles Discovery Endpoint
app.get(["/subtitles/:type/:id.json", "/:config/subtitles/:type/:id.json"], async (req, res) => {
  try {
    const { type, id } = req.params;
    const { lang, engine, apiKey, model, subdlKey, osKey, subsourceKey } = parseConfig(req.params.config);

    const idParts = id.split(":");
    const imdbId = idParts[0];
    const season = idParts[1] ? parseInt(idParts[1], 10) : null;
    const episode = idParts[2] ? parseInt(idParts[2], 10) : null;

    console.log(`\n[nifael AI] Subtitle query -> Type: ${type} | IMDb: ${imdbId} | S:${season || 0} E:${episode || 0} | Target: ${lang} | Engine: ${engine}`);

    const availableSubs = await searchAllSubtitles(imdbId, season, episode, { osKey, subdlKey, subsourceKey }, type);

    const host = req.get("host");
    const protocol = req.protocol;

    const stremioSubtitles = availableSubs
      .filter(sub => sub.downloadUrl)
      .slice(0, 10)
      .map((sub, idx) => {
        let renderUrl = `${protocol}://${host}/api/render-sub?targetLang=${lang}&engine=${engine}&subUrl=${encodeURIComponent(sub.downloadUrl)}`;
        if (apiKey) renderUrl += `&apiKey=${encodeURIComponent(apiKey)}`;
        if (model) renderUrl += `&model=${encodeURIComponent(model)}`;

        const engineLabel = model ? `${engine.toUpperCase()}:${model}` : engine.toUpperCase();

        return {
          id: `nifael_${sub.source.toLowerCase()}_${idx}`,
          url: renderUrl,
          lang: lang,
          label: `[nifael AI: ${engineLabel}] ${sub.source} (${sub.lang.toUpperCase()} ➔ ${lang.toUpperCase()}) - ${sub.fileName.substring(0, 30)}`
        };
      });

    res.json({ subtitles: stremioSubtitles });
  } catch (error) {
    console.error("[nifael AI] Error handling subtitle request:", error.message);
    res.json({ subtitles: [] });
  }
});

// 4. Subtitle Render & Translation Endpoint (With Automatic Ad Cleaner)
app.get("/api/render-sub", async (req, res) => {
  try {
    const { targetLang, subUrl, engine, apiKey, model } = req.query;

    if (!subUrl) {
      return res.status(400).send("Missing subUrl query parameter");
    }

    const lang = targetLang || "ms";
    const selectedEngine = engine || "google";
    const selectedModel = model || "";
    const cacheKey = `sub_${selectedEngine}_${selectedModel || 'def'}_${lang}_${subUrl}`;

    // Return cached WebVTT if available
    const cachedVtt = cache.get(cacheKey);
    if (cachedVtt) {
      console.log(`[nifael AI] Serving from cache: ${cacheKey.substring(0, 60)}...`);
      res.setHeader("Content-Type", "text/vtt; charset=utf-8");
      return res.send(cachedVtt);
    }

    console.log(`[nifael AI] Downloading & translating subtitle to '${lang}' using [${selectedEngine.toUpperCase()}] from: ${subUrl}`);

    const rawSrt = await downloadSubtitleText(subUrl);
    if (!rawSrt) {
      return res.status(502).send("Failed to download original subtitle file.");
    }

    // 1. Parse raw SRT into cues
    const rawCues = parseSrt(rawSrt);
    if (!rawCues || rawCues.length === 0) {
      return res.status(500).send("Failed to parse subtitle cues.");
    }

    // 2. Clean out ads, watermarks, and promotional links
    const cues = cleanCues(rawCues);

    // 3. Translate cleaned dialogue cues
    const translatedCues = await translateCues(cues, lang, selectedEngine, apiKey, selectedModel);

    // 4. Build standard WebVTT
    const vttContent = cuesToVtt(translatedCues);
    cache.set(cacheKey, vttContent);

    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    return res.send(vttContent);
  } catch (error) {
    console.error("[nifael AI] Translation render error:", error.message);
    res.status(500).send("Internal Server Error while rendering subtitle.");
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
  console.log(`[nifael AI] Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    console.log("[nifael AI] HTTP server closed.");
    process.exit(0);
  });
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

