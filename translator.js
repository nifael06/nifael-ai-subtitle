const axios = require("axios");

// Supported DeepL target languages
const DEEPL_LANGUAGES = new Set([
  "BG", "CS", "DA", "DE", "EL", "EN-GB", "EN-US", "ES", "ET", "FI", "FR",
  "HU", "ID", "IT", "JA", "KO", "LT", "LV", "NB", "NL", "PL", "PT-BR",
  "PT-PT", "RO", "RU", "SK", "SL", "SV", "TR", "UK", "ZH"
]);

/**
 * 1. Google Translate Engine (Free, uses POST to prevent URL length limits)
 */
async function translateWithGoogle(textBatch, targetLang) {
  try {
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
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 12000
      }
    );

    if (response.data && response.data[0]) {
      return response.data[0].map(item => item[0]).join("");
    }
    return textBatch;
  } catch (error) {
    console.error("[Google Translate error]:", error.message);
    return textBatch;
  }
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

/**
 * 2. Google Gemini AI Engine (Custom Model Support & Fallback)
 */
async function translateWithGemini(textBatch, targetLang, apiKey, customModel) {
  try {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) return await translateWithGoogle(textBatch, targetLang);

    const model = customModel || "gemini-3.5-flash-lite";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const prompt = `You are a professional movie subtitle translator. Translate the following subtitle batch into language code '${targetLang}'. Keep the exact same '<<<SEG>>>' separators untouched between subtitle lines. Do not add any conversational text, explanations, or markdown formatting, output ONLY the translated lines:\n\n${textBatch}`;

    const response = await axios.post(
      url,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 }
      },
      { timeout: 25000 }
    );

    const result = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return result || textBatch;
  } catch (error) {
    const status = error.response?.status;
    const errorMsg = error.response?.data?.error?.message || error.message || "";
    const errorStatus = error.response?.data?.error?.status || "";

    // Detect quota/rate-limit errors and throw dedicated error
    if (status === 429 || errorStatus === "RESOURCE_EXHAUSTED" ||
        errorMsg.toLowerCase().includes("quota") ||
        errorMsg.toLowerCase().includes("rate limit") ||
        errorMsg.toLowerCase().includes("resource exhausted")) {
      console.error(`[Gemini AI] Quota exceeded: ${errorMsg}`);
      throw new QuotaExceededError("Gemini", errorMsg);
    }

    console.error("[Gemini AI error]:", errorMsg);
    return await translateWithGoogle(textBatch, targetLang);
  }
}

/**
 * 3. OpenAI Engine (Custom Model Support & Fallback)
 */
async function translateWithOpenAI(textBatch, targetLang, apiKey, customModel) {
  try {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key) return await translateWithGoogle(textBatch, targetLang);

    const model = customModel || "gpt-4o-mini";

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
  } catch (error) {
    const status = error.response?.status;
    const errorMsg = error.response?.data?.error?.message || error.message || "";
    const errorCode = error.response?.data?.error?.code || "";
    const errorType = error.response?.data?.error?.type || "";

    // Detect quota/rate-limit errors and throw dedicated error
    if (status === 429 || errorCode === "insufficient_quota" ||
        errorType === "insufficient_quota" ||
        errorMsg.toLowerCase().includes("quota") ||
        errorMsg.toLowerCase().includes("rate limit")) {
      console.error(`[OpenAI] Quota exceeded: ${errorMsg}`);
      throw new QuotaExceededError("OpenAI", errorMsg);
    }

    console.error("[OpenAI error]:", errorMsg);
    return await translateWithGoogle(textBatch, targetLang);
  }
}

/**
 * 4. DeepL API Engine (Direct 1-to-1 array batching)
 */
async function translateWithDeepL(chunk, targetLang, apiKey) {
  try {
    const key = apiKey || process.env.DEEPL_API_KEY;
    if (!key) {
      const combined = chunk.map(c => c.text.replace(/\n/g, " ")).join("\n<<<SEG>>>\n");
      const googleRes = await translateWithGoogle(combined, targetLang);
      return parseTranslatedBlock(googleRes, chunk);
    }

    // Normalize DeepL language code
    let normLang = targetLang.toUpperCase();
    if (normLang === "EN") normLang = "EN-US";
    if (normLang === "PT") normLang = "PT-PT";

    if (!DEEPL_LANGUAGES.has(normLang)) {
      console.warn(`[DeepL] Target language '${targetLang}' not supported by DeepL, falling back to Google Translate`);
      const combined = chunk.map(c => c.text.replace(/\n/g, " ")).join("\n<<<SEG>>>\n");
      const googleRes = await translateWithGoogle(combined, targetLang);
      return parseTranslatedBlock(googleRes, chunk);
    }

    const isFreeKey = key.endsWith(":fx");
    const endpoint = isFreeKey ? "https://api-free.deepl.com/v2/translate" : "https://api.deepl.com/v2/translate";

    const params = new URLSearchParams();
    params.append("auth_key", key);
    params.append("target_lang", normLang);
    chunk.forEach(cue => params.append("text", cue.text.replace(/\n/g, " ")));

    const response = await axios.post(endpoint, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000
    });

    const translations = response.data?.translations;
    if (Array.isArray(translations) && translations.length === chunk.length) {
      return chunk.map((cue, idx) => ({
        ...cue,
        text: translations[idx].text.trim()
      }));
    }

    return chunk;
  } catch (error) {
    console.error("[DeepL error]:", error.message);
    const combined = chunk.map(c => c.text.replace(/\n/g, " ")).join("\n<<<SEG>>>\n");
    const googleRes = await translateWithGoogle(combined, targetLang);
    return parseTranslatedBlock(googleRes, chunk);
  }
}

/**
 * Robust delimiter parser preventing cue desync
 */
function parseTranslatedBlock(translatedBlock, chunk) {
  const parts = translatedBlock.split(/<<<SEG>>>|<<<\s*SEG\s*>>>/i);

  return chunk.map((cue, index) => {
    const textPart = parts[index];
    return {
      ...cue,
      text: textPart ? textPart.trim() : cue.text
    };
  });
}

/**
 * Translates a single chunk of cues
 */
async function translateChunk(chunk, targetLang, engine, apiKey, customModel) {
  if (engine === "deepl") {
    return await translateWithDeepL(chunk, targetLang, apiKey);
  }

  const DELIMITER = "\n<<<SEG>>>\n";
  const combinedText = chunk.map(cue => cue.text.replace(/\n/g, " ")).join(DELIMITER);

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
 * Master concurrent batch translator dispatcher (5x-8x speedup)
 * Returns { cues: [...], quotaExceeded: bool, engine: string }
 */
async function translateCues(cues, targetLang = "en", engine = "google", apiKey = "", customModel = "") {
  console.log(`[nifael AI] Translating ${cues.length} cues to '${targetLang}' using: [${engine.toUpperCase()}] Model: [${customModel || "default"}]`);

  const BATCH_SIZE = engine === "google" ? 40 : 30;
  const chunks = [];

  for (let i = 0; i < cues.length; i += BATCH_SIZE) {
    chunks.push(cues.slice(i, i + BATCH_SIZE));
  }

  // Concurrency pool (up to 6 parallel requests)
  const CONCURRENCY = engine === "google" ? 6 : 4;
  const results = new Array(chunks.length);
  let currentIndex = 0;
  let quotaExceeded = false;
  let quotaEngine = "";

  async function worker() {
    while (currentIndex < chunks.length) {
      const idx = currentIndex++;
      try {
        // If quota was already hit by another worker, translate remaining with Google
        if (quotaExceeded) {
          results[idx] = await translateChunk(chunks[idx], targetLang, "google", "", "");
        } else {
          results[idx] = await translateChunk(chunks[idx], targetLang, engine, apiKey, customModel);
        }
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          quotaExceeded = true;
          quotaEngine = err.engine;
          console.warn(`[nifael AI] ${err.engine} quota exceeded at chunk ${idx}, switching remaining to Google Translate`);
          // Translate this failed chunk with Google as fallback
          try {
            results[idx] = await translateChunk(chunks[idx], targetLang, "google", "", "");
          } catch (fallbackErr) {
            console.error(`[nifael AI] Google fallback also failed for chunk ${idx}:`, fallbackErr.message);
            results[idx] = chunks[idx];
          }
        } else {
          console.error(`[nifael AI] Chunk ${idx} translation error:`, err.message);
          results[idx] = chunks[idx];
        }
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY, chunks.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  return {
    cues: results.flat(),
    quotaExceeded,
    engine: quotaEngine
  };
}

module.exports = { translateCues };

