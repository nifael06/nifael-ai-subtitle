const axios = require("axios");

// Supported DeepL target languages
const DEEPL_LANGUAGES = new Set([
  "BG", "CS", "DA", "DE", "EL", "EN-GB", "EN-US", "ES", "ET", "FI", "FR",
  "HU", "ID", "IT", "JA", "KO", "LT", "LV", "NB", "NL", "PL", "PT-BR",
  "PT-PT", "RO", "RU", "SK", "SL", "SV", "TR", "UK", "ZH"
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const BROWSER_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
];

function getRandomUserAgent() {
  return BROWSER_USER_AGENTS[Math.floor(Math.random() * BROWSER_USER_AGENTS.length)];
}

// In-memory Bing Translator session state (cached for 10 minutes)
let bingSession = { key: "", token: "", ig: "", iid: "", cookie: "", expiresAt: 0 };

/**
 * Fetch and refresh Bing Translator token and session cookies
 */
async function getBingSession() {
  if (bingSession.key && bingSession.token && Date.now() < bingSession.expiresAt) {
    return bingSession;
  }
  try {
    const pageRes = await axios.get("https://www.bing.com/translator", {
      headers: { "User-Agent": getRandomUserAgent() },
      timeout: 8000
    });
    const html = pageRes.data;
    const igMatch = html.match(/IG:"([A-Za-z0-9]+)"/);
    const iidMatch = html.match(/data-iid="([^"]+)"/);
    const paramsMatch = html.match(/params_AbusePreventionHelper\s*=\s*\[([^\]]+)\]/);

    let key = "", token = "";
    if (paramsMatch) {
      const arr = paramsMatch[1].split(",");
      key = arr[0]?.replace(/"/g, "").trim();
      token = arr[1]?.replace(/"/g, "").trim();
    }
    const cookie = pageRes.headers["set-cookie"]?.map((c) => c.split(";")[0]).join("; ") || "";

    bingSession = {
      ig: igMatch?.[1] || "",
      iid: iidMatch?.[1] || "translator.5023",
      key,
      token,
      cookie,
      expiresAt: Date.now() + 10 * 60 * 1000
    };
    return bingSession;
  } catch (e) {
    console.warn("[Bing Session Init Warning]:", e.message);
    return bingSession;
  }
}

/**
 * 1. Bing / Microsoft Translator Web API (Datacenter IP resistant)
 */
async function translateWithBing(textBatch, targetLang, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const session = await getBingSession();
      const url = `https://www.bing.com/ttranslatev3?isVertical=1${session.ig ? `&IG=${session.ig}` : ""}${session.iid ? `&IID=${session.iid}` : ""}`;
      const params = new URLSearchParams();
      params.append("fromLang", "auto-detect");
      params.append("text", textBatch);
      params.append("to", targetLang);
      if (session.key && session.token) {
        params.append("key", session.key);
        params.append("token", session.token);
      }

      const res = await axios.post(url, params.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": getRandomUserAgent(),
          ...(session.cookie ? { Cookie: session.cookie } : {})
        },
        timeout: 12000
      });

      if (Array.isArray(res.data) && res.data[0]?.translations?.[0]?.text) {
        return res.data[0].translations[0].text;
      }
    } catch (e) {
      console.warn(`[Bing Translate attempt ${attempt + 1}]:`, e.message);
      bingSession.expiresAt = 0; // Invalidate session to refresh
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  return textBatch;
}

/**
 * Helper: Call Google Translate primary POST endpoint (gtx)
 */
async function callGooglePrimaryPost(textBatch, targetLang) {
  const params = new URLSearchParams();
  params.append("client", "gtx");
  params.append("sl", "auto");
  params.append("tl", targetLang);
  params.append("dt", "t");
  params.append("q", textBatch);

  const response = await axios.post(
    "https://translate.googleapis.com/translate_a/single",
    params.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": getRandomUserAgent()
      },
      timeout: 10000
    }
  );

  if (response.data && Array.isArray(response.data[0])) {
    return response.data[0].map((item) => (Array.isArray(item) ? item[0] : item)).join("");
  }
  return null;
}

/**
 * Helper: Call Google Translate primary GET endpoint (gtx)
 */
async function callGooglePrimaryGet(textBatch, targetLang) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(textBatch)}`;
  const response = await axios.get(url, {
    headers: { "User-Agent": getRandomUserAgent() },
    timeout: 10000
  });

  if (response.data && Array.isArray(response.data[0])) {
    return response.data[0].map((item) => (Array.isArray(item) ? item[0] : item)).join("");
  }
  return null;
}

/**
 * Helper: Call Google Translate backup endpoint (dict-chrome-ex)
 */
async function callGoogleBackupClients5(textBatch, targetLang) {
  const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${targetLang}&q=${encodeURIComponent(textBatch)}`;
  const response = await axios.get(url, {
    headers: { "User-Agent": getRandomUserAgent() },
    timeout: 10000
  });

  const data = response.data;
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return Array.isArray(parsed[0]) ? parsed[0].join("") : parsed.join("");
      }
      return parsed;
    } catch {
      return data;
    }
  }
  if (Array.isArray(data)) {
    if (typeof data[0] === "string") return data.join("");
    if (Array.isArray(data[0])) return data[0].map((i) => (Array.isArray(i) ? i[0] : i)).join("");
  }
  return String(data || "");
}

// Google Translate Circuit Breaker State (cooldown 10 minutes on 429)
let googleCircuitOpenUntil = 0;

function isGoogleCircuitOpen() {
  return Date.now() < googleCircuitOpenUntil;
}

function tripGoogleCircuit(durationMs = 10 * 60 * 1000) {
  const wasOpen = isGoogleCircuitOpen();
  googleCircuitOpenUntil = Date.now() + durationMs;
  if (!wasOpen) {
    console.warn(`[Google Translate] 429 Rate Limit detected on server IP. Circuit breaker activated: routing directly to Bing Translator for 10m.`);
  }
}

/**
 * 2. Primary Google Translate with Instant Bing & Mirror Cascade + Circuit Breaker
 */
async function translateWithGoogle(textBatch, targetLang, maxRetries = 2) {
  // If circuit breaker is active, go directly to Bing without wasting time on Google 429
  if (isGoogleCircuitOpen()) {
    const bingRes = await translateWithBing(textBatch, targetLang);
    if (bingRes && bingRes !== textBatch && typeof bingRes === "string" && bingRes.trim()) {
      return bingRes;
    }
  }

  const backoffDelays = [400, 800, 1500];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      let result = null;

      if (attempt === 0) {
        result = await callGooglePrimaryPost(textBatch, targetLang);
      } else if (attempt % 2 === 1) {
        result = await callGoogleBackupClients5(textBatch, targetLang);
      } else {
        result = await callGooglePrimaryGet(textBatch, targetLang);
      }

      if (result && typeof result === "string" && result.trim()) {
        return result;
      }
    } catch (error) {
      const status = error.response?.status;
      const isRateLimit = status === 429;

      // If Google rate-limits (429), trip circuit breaker & immediately invoke Bing Translator
      if (isRateLimit) {
        tripGoogleCircuit();
        const bingRes = await translateWithBing(textBatch, targetLang);
        if (bingRes && bingRes !== textBatch && typeof bingRes === "string" && bingRes.trim()) {
          return bingRes;
        }
      }

      if (attempt < maxRetries) {
        const delay = backoffDelays[attempt] || 1000;
        await sleep(delay);
        continue;
      }
    }
  }

  // Final fallback to Bing Translator before returning raw text
  try {
    const fallbackBing = await translateWithBing(textBatch, targetLang);
    if (fallbackBing && fallbackBing !== textBatch && typeof fallbackBing === "string" && fallbackBing.trim()) {
      return fallbackBing;
    }
  } catch {}

  return textBatch;
}

/**
 * Custom error for API quota/rate limit exceeded
 */
class QuotaExceededError extends Error {
  constructor(engine, details) {
    super(`${engine} API quota exceeded: ${details}`);
    this.name = "QuotaExceededError";
    this.engine = engine;
    this.details = details;
  }
}

// Active Google Gemini models in order of priority (Gemini 3.5 Live Translate and newer)
const GEMINI_ACTIVE_MODELS = [
  "gemini-3.5-live-translate",
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.5-pro",
  "gemini-3.7-pro"
];

function sanitizeGeminiModel(customModel) {
  if (!customModel || typeof customModel !== "string") return "gemini-3.5-live-translate";
  const trimmed = customModel.trim();
  // Auto-upgrade legacy models (1.0, 1.5, 2.0, 2.5) to gemini-3.5-live-translate
  if (/gemini-(1\.|2\.)/i.test(trimmed)) {
    console.warn(`[Gemini AI] Legacy model '${customModel}' requested. Auto-upgrading to 'gemini-3.5-live-translate'.`);
    return "gemini-3.5-live-translate";
  }
  return trimmed;
}

/**
 * 3. Google Gemini AI Engine (Safety BLOCK_NONE, Auto Model Deprecation Fallback & Quota Protection)
 */
async function translateWithGemini(textBatch, targetLang, apiKey, customModel, maxRetries = 3) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) return await translateWithGoogle(textBatch, targetLang);

  let model = sanitizeGeminiModel(customModel);
  let fallbackIndex = 0;
  const backoffDelays = [500, 1000, 2000];

  const safetySettings = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" }
  ];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const prompt = `You are a professional movie subtitle translator. Translate the following subtitle batch into language code '${targetLang}'. Keep the exact same '<<<SEG>>>' separators untouched between subtitle lines. Do not add any conversational text, explanations, or markdown formatting, output ONLY the translated lines:\n\n${textBatch}`;

      const response = await axios.post(
        url,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2 },
          safetySettings
        },
        { timeout: 25000 }
      );

      const result = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (result && typeof result === "string" && result.trim()) {
        return result;
      }
      return textBatch;
    } catch (error) {
      const status = error.response?.status;
      const errorMsg = error.response?.data?.error?.message || error.message || "";
      const errorStatus = error.response?.data?.error?.status || "";

      // 1. Detect Model Deprecation / Not Found / No longer available
      const isModelUnavailable =
        status === 404 ||
        (status === 400 && (
          errorMsg.toLowerCase().includes("no longer available") ||
          errorMsg.toLowerCase().includes("not found") ||
          errorMsg.toLowerCase().includes("deprecated") ||
          errorMsg.toLowerCase().includes("not supported") ||
          errorMsg.toLowerCase().includes("models/")
        ));

      if (isModelUnavailable && fallbackIndex < GEMINI_ACTIVE_MODELS.length) {
        const nextModel = GEMINI_ACTIVE_MODELS[fallbackIndex++];
        if (nextModel !== model) {
          console.warn(`[Gemini AI] Model '${model}' is unavailable (${errorMsg || status}), auto-switching to active model '${nextModel}'...`);
          model = nextModel;
          continue;
        }
      }

      // 2. Quota / Resource Exhausted
      const isRateLimitOrExhausted =
        status === 429 ||
        errorStatus === "RESOURCE_EXHAUSTED" ||
        errorMsg.toLowerCase().includes("quota") ||
        errorMsg.toLowerCase().includes("rate limit") ||
        errorMsg.toLowerCase().includes("resource exhausted");

      if (isRateLimitOrExhausted && attempt < maxRetries) {
        const delay = backoffDelays[attempt] || 1500;
        console.warn(`[Gemini AI] Quota/Rate-limit hit, retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      if (isRateLimitOrExhausted) {
        console.error(`[Gemini AI] Quota exceeded: ${errorMsg}`);
        throw new QuotaExceededError("Gemini", errorMsg);
      }

      console.error("[Gemini AI error]:", errorMsg);
      return await translateWithGoogle(textBatch, targetLang);
    }
  }

  return await translateWithGoogle(textBatch, targetLang);
}

/**
 * 4. OpenAI Engine (Custom Model Support, 404 Fallback to gpt-4o-mini & Fallback)
 */
async function translateWithOpenAI(textBatch, targetLang, apiKey, customModel) {
  try {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key) return await translateWithGoogle(textBatch, targetLang);

    let model = customModel || "gpt-4o-mini";

    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: model,
          messages: [
            {
              role: "system",
              content: `You are a professional movie subtitle translator. Translate dialogue into language '${targetLang}'. Retain all '<<<SEG>>>' delimiters verbatim. Return ONLY the translated subtitle lines.`
            },
            { role: "user", content: textBatch }
          ],
          temperature: 0.2
        },
        {
          headers: { Authorization: `Bearer ${key}` },
          timeout: 25000
        }
      );

      const result = response.data?.choices?.[0]?.message?.content;
      return result || textBatch;
    } catch (apiErr) {
      // If custom model returns 404, fallback to gpt-4o-mini
      if (apiErr.response?.status === 404 && model !== "gpt-4o-mini") {
        console.warn(`[OpenAI] Model '${model}' not found, falling back to 'gpt-4o-mini'...`);
        const fallbackRes = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          {
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `You are a professional movie subtitle translator. Translate dialogue into language '${targetLang}'. Retain all '<<<SEG>>>' delimiters verbatim. Return ONLY the translated subtitle lines.`
              },
              { role: "user", content: textBatch }
            ],
            temperature: 0.2
          },
          {
            headers: { Authorization: `Bearer ${key}` },
            timeout: 25000
          }
        );
        return fallbackRes.data?.choices?.[0]?.message?.content || textBatch;
      }
      throw apiErr;
    }
  } catch (error) {
    const status = error.response?.status;
    const errorMsg = error.response?.data?.error?.message || error.message || "";
    const errorCode = error.response?.data?.error?.code || "";

    if (
      status === 429 ||
      errorCode === "insufficient_quota" ||
      errorMsg.toLowerCase().includes("quota") ||
      errorMsg.toLowerCase().includes("rate limit")
    ) {
      console.error(`[OpenAI] Quota exceeded: ${errorMsg}`);
      throw new QuotaExceededError("OpenAI", errorMsg);
    }

    console.error("[OpenAI error]:", errorMsg);
    return await translateWithGoogle(textBatch, targetLang);
  }
}

/**
 * 5. DeepL API Engine (Direct 1-to-1 array batching)
 */
async function translateWithDeepL(chunk, targetLang, apiKey) {
  try {
    const key = apiKey || process.env.DEEPL_API_KEY;
    if (!key) {
      const combined = chunk.map((c) => (c?.text ? c.text.replace(/\n/g, " ") : "")).join("\n<<<SEG>>>\n");
      const googleRes = await translateWithGoogle(combined, targetLang);
      return parseTranslatedBlock(googleRes, chunk);
    }

    let normLang = targetLang.toUpperCase();
    if (normLang === "EN") normLang = "EN-US";
    if (normLang === "PT") normLang = "PT-PT";

    if (!DEEPL_LANGUAGES.has(normLang)) {
      console.warn(`[DeepL] Target language '${targetLang}' not supported by DeepL, falling back to Google/Bing`);
      const combined = chunk.map((c) => (c?.text ? c.text.replace(/\n/g, " ") : "")).join("\n<<<SEG>>>\n");
      const googleRes = await translateWithGoogle(combined, targetLang);
      return parseTranslatedBlock(googleRes, chunk);
    }

    const isFreeKey = key.endsWith(":fx");
    const endpoint = isFreeKey ? "https://api-free.deepl.com/v2/translate" : "https://api.deepl.com/v2/translate";

    const params = new URLSearchParams();
    params.append("auth_key", key);
    params.append("target_lang", normLang);
    chunk.forEach((cue) => params.append("text", cue?.text ? cue.text.replace(/\n/g, " ") : ""));

    const response = await axios.post(endpoint, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000
    });

    const translations = response.data?.translations;
    if (Array.isArray(translations) && translations.length === chunk.length) {
      return chunk.map((cue, idx) => ({
        ...cue,
        text: translations[idx]?.text ? translations[idx].text.trim() : (cue?.text || "")
      }));
    }

    return chunk;
  } catch (error) {
    const status = error.response?.status;
    const errorMsg = error.response?.data?.message || error.message || "";

    if (status === 456 || status === 429 || errorMsg.toLowerCase().includes("quota")) {
      console.error(`[DeepL] Quota exceeded: ${errorMsg}`);
      throw new QuotaExceededError("DeepL", errorMsg);
    }

    console.error("[DeepL error]:", error.message);
    const combined = chunk.map((c) => (c?.text ? c.text.replace(/\n/g, " ") : "")).join("\n<<<SEG>>>\n");
    const googleRes = await translateWithGoogle(combined, targetLang);
    return parseTranslatedBlock(googleRes, chunk);
  }
}

/**
 * Robust Delimiter Parser & Delimiter Mismatch Protection
 * If AI model drops or alters delimiters, falls back gracefully line-by-line without truncating
 */
function parseTranslatedBlock(translatedBlock, chunk) {
  if (!translatedBlock || typeof translatedBlock !== "string" || !Array.isArray(chunk)) {
    return chunk || [];
  }

  // 1. Try standard delimiter split
  let parts = translatedBlock
    .split(/<<<SEG>>>|<<<\s*SEG\s*>>>|---SEG---|---\s*SEG\s*---|\[SEG\]/i)
    .map((p) => p.trim());

  // If exact match
  if (parts.length === chunk.length) {
    return chunk.map((cue, index) => ({
      ...cue,
      text: parts[index] && parts[index].length > 0 ? parts[index] : (cue?.text || "")
    }));
  }

  // 2. Delimiter Mismatch Protection: Fall back to newline splitting if count matches
  const lineParts = translatedBlock.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lineParts.length === chunk.length) {
    return chunk.map((cue, index) => ({
      ...cue,
      text: lineParts[index] || cue?.text || ""
    }));
  }

  // 3. Graceful partial mapping without dropping/truncating subsequent cues
  return chunk.map((cue, index) => ({
    ...cue,
    text: parts[index] !== undefined && parts[index].length > 0 ? parts[index] : (cue?.text || "")
  }));
}

/**
 * Translates a single chunk of cues
 */
async function translateChunk(chunk, targetLang, engine, apiKey, customModel) {
  if (!chunk || chunk.length === 0) return [];

  if (engine === "deepl") {
    return await translateWithDeepL(chunk, targetLang, apiKey);
  }

  if (engine === "gemini_live") {
    const { streamTranslateGemini } = require("./geminiStream");
    const DELIMITER = "\n<<<SEG>>>\n";
    const combinedText = chunk.map((cue) => (cue?.text ? cue.text.replace(/\n/g, " ") : "")).join(DELIMITER);
    try {
      const translatedBlock = await streamTranslateGemini(combinedText, targetLang, apiKey, customModel);
      return parseTranslatedBlock(translatedBlock, chunk);
    } catch (e) {
      console.warn("[Gemini Live Stream fallback]:", e.message);
      const googleRes = await translateWithGoogle(combinedText, targetLang);
      return parseTranslatedBlock(googleRes, chunk);
    }
  }

  const DELIMITER = "\n<<<SEG>>>\n";
  const combinedText = chunk.map((cue) => (cue?.text ? cue.text.replace(/\n/g, " ") : "")).join(DELIMITER);

  let translatedBlock = "";
  if (engine === "gemini") {
    translatedBlock = await translateWithGemini(combinedText, targetLang, apiKey, customModel);
  } else if (engine === "openai") {
    translatedBlock = await translateWithOpenAI(combinedText, targetLang, apiKey, customModel);
  } else {
    translatedBlock = await translateWithGoogle(combinedText, targetLang);
  }

  return parseTranslatedBlock(translatedBlock, chunk);
}

/**
 * Turbo Parallel Batch Translator with Consolidated Batches & Pacing
 */
async function translateCues(cues, targetLang = "en", engine = "google", apiKey = "", customModel = "") {
  const startTime = Date.now();
  const cueList = Array.isArray(cues) ? cues : (cues && Array.isArray(cues.cues) ? cues.cues : []);
  console.log(`[nifael AI] Translating ${cueList.length} cues to '${targetLang}' using: [${engine.toUpperCase()}] Model: [${customModel || "default"}]`);

  // Consolidated batch sizes: 100-140 cues reduces total HTTP requests to ~6-10 for full movies
  const BATCH_SIZE = engine === "deepl" ? 50 : engine === "gemini_live" ? 100 : 120;
  const chunks = [];

  for (let i = 0; i < cueList.length; i += BATCH_SIZE) {
    chunks.push(cueList.slice(i, i + BATCH_SIZE));
  }

  const CONCURRENCY = engine === "google" ? 2 : engine === "deepl" ? 5 : engine === "gemini_live" ? 6 : 4;
  const results = new Array(chunks.length);
  let currentIndex = 0;
  let quotaExceeded = false;
  let quotaEngine = "";

  async function worker(workerId) {
    if ((engine === "google" || quotaExceeded) && workerId > 0) {
      await sleep(workerId * 150);
    }

    while (currentIndex < chunks.length) {
      const idx = currentIndex++;
      try {
        if (quotaExceeded) {
          results[idx] = await translateChunk(chunks[idx], targetLang, "google", "", "");
        } else {
          results[idx] = await translateChunk(chunks[idx], targetLang, engine, apiKey, customModel);
        }
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          quotaExceeded = true;
          quotaEngine = err.engine;
          console.warn(`[nifael AI] ${err.engine} quota exceeded at chunk ${idx}, switching remaining to Google/Bing Translate`);
          try {
            results[idx] = await translateChunk(chunks[idx], targetLang, "google", "", "");
          } catch (fallbackErr) {
            console.error(`[nifael AI] Fallback failed for chunk ${idx}:`, fallbackErr.message);
            results[idx] = chunks[idx];
          }
        } else {
          console.error(`[nifael AI] Chunk ${idx} translation error:`, err.message);
          results[idx] = chunks[idx];
        }
      }

      // 150ms throttle delay between batch requests
      if (engine === "google" || quotaExceeded) {
        await sleep(150);
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY, chunks.length);
  const workers = Array.from({ length: workerCount }, (_, i) => worker(i));
  await Promise.all(workers);

  const elapsed = Date.now() - startTime;
  console.log(`[nifael AI] ✅ Translated ${cueList.length} cues in ${chunks.length} chunks (${workerCount} workers) → ${elapsed}ms`);

  return {
    cues: results.flat(),
    quotaExceeded,
    engine: quotaEngine
  };
}

module.exports = {
  translateCues,
  translateWithGoogle,
  translateWithBing,
  translateWithGemini,
  translateWithOpenAI,
  translateWithDeepL,
  parseTranslatedBlock
};
