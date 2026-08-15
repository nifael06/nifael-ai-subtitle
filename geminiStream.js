const axios = require("axios");

// Fallback cascade for active Google Gemini 3.5+ models only
const GEMINI_LIVE_MODELS = [
  "gemini-3.5-live-translate-preview",
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.5-pro",
  "gemini-3.7-pro"
];

const SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" }
];

let cachedWorkingModel = null;

/**
 * Filter and sanitize model name to ensure only Gemini 3.5+ models are used
 */
function sanitizeGeminiModel(customModel) {
  if (!customModel || typeof customModel !== "string") return cachedWorkingModel || "gemini-3.5-live-translate-preview";
  const trimmed = customModel.trim();
  if (/gemini-(1\.|2\.)/i.test(trimmed)) {
    return "gemini-3.5-live-translate-preview";
  }
  return trimmed;
}

/**
 * Maps display/preview names to active Gemini 3.5+ API endpoints
 */
function resolveApiModel(modelName) {
  if (!modelName || typeof modelName !== "string") return cachedWorkingModel || "gemini-3.5-flash-lite";
  const trimmed = modelName.trim().toLowerCase();
  if (trimmed === "gemini-3.5-live-translate-preview" || trimmed === "gemini-3.5-live-translate") {
    return "gemini-3.5-flash-lite";
  }
  return modelName.trim();
}

const LANGUAGE_NAMES = {
  ms: "Malay (Bahasa Melayu)",
  id: "Indonesian (Bahasa Indonesia)",
  en: "English",
  es: "Spanish (Español)",
  fr: "French (Français)",
  de: "German (Deutsch)",
  it: "Italian (Italiano)",
  pt: "Portuguese (Português)",
  ru: "Russian (Русский)",
  ja: "Japanese (日本語)",
  ko: "Korean (한국어)",
  zh: "Simplified Chinese (简体中文)",
  zt: "Traditional Chinese (繁體中文)",
  ar: "Arabic (العربية)",
  hi: "Hindi (हिन्दी)",
  th: "Thai (ไทย)",
  vi: "Vietnamese (Tiếng Việt)",
  tl: "Filipino (Tagalog)",
  tr: "Turkish (Türkçe)",
  nl: "Dutch (Nederlands)",
  pl: "Polish (Polski)",
  sv: "Swedish (Svenska)",
  da: "Danish (Dansk)",
  no: "Norwegian (Norsk)",
  fi: "Finnish (Suomi)",
  el: "Greek (Ελληνικά)",
  cs: "Czech (Čeština)",
  ro: "Romanian (Română)",
  hu: "Hungarian (Magyar)",
  uk: "Ukrainian (Українська)",
  he: "Hebrew (עברית)",
  bn: "Bengali (বাংলা)",
  ta: "Tamil (தமிழ்)",
  te: "Telugu (తెలుగు)",
  ur: "Urdu (اردو)",
  fa: "Persian (فارسی)"
};

function getLanguageName(code) {
  if (!code) return "English";
  const clean = String(code).toLowerCase().trim().split("-")[0];
  return LANGUAGE_NAMES[clean] || LANGUAGE_NAMES[code.toLowerCase()] || code;
}

/**
 * 1. Ultra-fast progressive Gemini translation engine with multi-model fallback cascade
 */
async function streamTranslateGemini(textBatch, targetLang, apiKey, modelName = "") {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("Gemini API key is required for Gemini Live Stream");
  }

  const requestedModel = (modelName && typeof modelName === "string" && modelName.trim()) ? sanitizeGeminiModel(modelName) : null;
  const primaryApiModel = resolveApiModel(requestedModel);

  // Build list of Gemini 3.5+ models to try in sequence
  const candidateModels = [
    primaryApiModel,
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.6-flash",
    "gemini-3.7-flash",
    "gemini-3.5-pro",
    "gemini-3.7-pro"
  ].filter((m, idx, arr) => m && arr.indexOf(m) === idx);

  let lastError = null;
  const langName = getLanguageName(targetLang);

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const prompt = `You are a professional movie and television subtitle translator.
Translate all subtitle text strictly into ${langName}.
Keep all '<<<SEG>>>' and '---SEG---' delimiters verbatim between subtitle lines.
Every single line must be written in ${langName}. Return ONLY the translated subtitle lines:\n\n${textBatch}`;

      const response = await axios.post(
        url,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.15 },
          safetySettings: SAFETY_SETTINGS
        },
        { timeout: 25000 }
      );

      const result = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (result && typeof result === "string" && result.trim()) {
        cachedWorkingModel = model;
        return result;
      }
      return textBatch;
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      const errorMsg = error.response?.data?.error?.message || error.message || "";

      const isModelUnavailable =
        status === 404 ||
        (status === 400 && (
          errorMsg.toLowerCase().includes("no longer available") ||
          errorMsg.toLowerCase().includes("not found") ||
          errorMsg.toLowerCase().includes("deprecated") ||
          errorMsg.toLowerCase().includes("not supported") ||
          errorMsg.toLowerCase().includes("models/")
        ));

      if (isModelUnavailable) {
        continue;
      }

      throw error;
    }
  }

  if (lastError) throw lastError;
  return textBatch;
}

/**
 * 2. Stage 1: Multimodal Native Speech-to-Text Transcription with Precise Timestamps
 */
async function audioToOriginalTranscriptGemini(audioBase64, apiKey, modelName = "") {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("Gemini API key is required for Audio Transcription");
  }

  if (!audioBase64 || typeof audioBase64 !== "string") {
    throw new Error("Invalid or empty audio buffer");
  }

  const requestedModel = (modelName && typeof modelName === "string" && modelName.trim()) ? sanitizeGeminiModel(modelName) : null;
  const primaryApiModel = resolveApiModel(requestedModel);

  const candidateModels = [
    primaryApiModel || "gemini-3.5-flash",
    "gemini-3.5-flash",
    "gemini-3.5-pro",
    "gemini-3.6-flash",
    "gemini-3.7-flash",
    "gemini-3.5-flash-lite"
  ].filter((m, idx, arr) => m && arr.indexOf(m) === idx);

  let lastError = null;

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const promptText = `You are a master audio transcriber. Listen to the audio clip and transcribe ALL spoken dialogue verbatim in its original spoken language with exact start and end timestamps.

Rules:
1. Transcribe EVERY spoken sentence, word, or character name in the original language.
2. Synchronize timestamps to the exact voice start and end points in the audio.
3. Output strictly in standard numbered SubRip (SRT) format without markdown backticks:

1
00:00:01,000 --> 00:00:04,500
[Exact spoken text in original language]

2
00:00:05,000 --> 00:00:08,200
[Exact spoken text in original language]`;

      const response = await axios.post(
        url,
        {
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType: "audio/mp3",
                    data: audioBase64
                  }
                },
                {
                  text: promptText
                }
              ]
            }
          ],
          generationConfig: { temperature: 0.1 },
          safetySettings: SAFETY_SETTINGS
        },
        { timeout: 60000 }
      );

      const result = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (result && typeof result === "string" && result.trim()) {
        cachedWorkingModel = model;
        return result.replace(/```(?:srt|vtt)?/gi, "").replace(/```/g, "").trim();
      }
      return "";
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      const errorMsg = error.response?.data?.error?.message || error.message || "";

      const isModelUnavailable =
        status === 404 ||
        (status === 400 && (
          errorMsg.toLowerCase().includes("no longer available") ||
          errorMsg.toLowerCase().includes("not found") ||
          errorMsg.toLowerCase().includes("deprecated") ||
          errorMsg.toLowerCase().includes("not supported") ||
          errorMsg.toLowerCase().includes("models/")
        ));

      if (isModelUnavailable) {
        continue;
      }

      if (status === 429) {
        console.warn(`[Gemini Audio Transcription Rate Limit]: Sleeping 2500ms before retrying next model...`);
        await new Promise(r => setTimeout(r, 2500));
        continue;
      }

      console.error("[Gemini Audio Transcription Error]:", errorMsg);
      throw error;
    }
  }

  if (lastError) throw lastError;
  return "";
}

/**
 * 3. Multimodal Audio-to-Subtitle transcription and live translation
 */
async function audioToSubtitleGemini(audioBase64, targetLang, apiKey, modelName = "") {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("Gemini API key is required for Audio-to-Subtitle AI transcription");
  }

  if (!audioBase64 || typeof audioBase64 !== "string") {
    throw new Error("Invalid or empty audio buffer");
  }

  const requestedModel = (modelName && typeof modelName === "string" && modelName.trim()) ? sanitizeGeminiModel(modelName) : null;
  const primaryApiModel = resolveApiModel(requestedModel);

  const candidateModels = [
    primaryApiModel || "gemini-3.5-flash",
    "gemini-3.5-flash",
    "gemini-3.5-pro",
    "gemini-3.6-flash",
    "gemini-3.7-flash",
    "gemini-3.5-flash-lite"
  ].filter((m, idx, arr) => m && arr.indexOf(m) === idx);

  let lastError = null;
  const langName = getLanguageName(targetLang);

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const promptText = `You are a professional movie and television subtitle translator.
Your instructions:
1. Listen carefully to all character voices and speech in this audio clip.
2. Translate all spoken dialogue directly into ${langName}.
3. Every single output subtitle line MUST be written entirely in ${langName}. Do NOT use Japanese, English, or any other language unless the target language is that language.
4. Synchronize the start and end timestamps precisely to the voice.
5. If there is no dialogue or only background music/silence, return nothing.

Output strictly in standard numbered SubRip (SRT) format without markdown backticks:
1
00:00:01,000 --> 00:00:04,500
[Translated subtitle in ${langName}]

2
00:00:05,000 --> 00:00:08,200
[Translated subtitle in ${langName}]`;

      const response = await axios.post(
        url,
        {
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType: "audio/mp3",
                    data: audioBase64
                  }
                },
                {
                  text: promptText
                }
              ]
            }
          ],
          generationConfig: { temperature: 0.1 },
          safetySettings: SAFETY_SETTINGS
        },
        { timeout: 60000 }
      );

      const result = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (result && typeof result === "string" && result.trim()) {
        cachedWorkingModel = model;
        return result.replace(/```(?:srt|vtt)?/gi, "").replace(/```/g, "").trim();
      }
      return "";
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      const errorMsg = error.response?.data?.error?.message || error.message || "";

      const isModelUnavailable =
        status === 404 ||
        (status === 400 && (
          errorMsg.toLowerCase().includes("no longer available") ||
          errorMsg.toLowerCase().includes("not found") ||
          errorMsg.toLowerCase().includes("deprecated") ||
          errorMsg.toLowerCase().includes("not supported") ||
          errorMsg.toLowerCase().includes("models/")
        ));

      if (isModelUnavailable) {
        continue;
      }

      if (status === 429) {
        console.warn(`[Gemini Audio AI Rate Limit]: Sleeping 2500ms before retrying next candidate model...`);
        await new Promise(r => setTimeout(r, 2500));
        continue;
      }

      console.error("[Gemini Audio-to-Subtitle Error]:", errorMsg);
      throw error;
    }
  }

  if (lastError) throw lastError;
  return "";
}

module.exports = {
  streamTranslateGemini,
  audioToOriginalTranscriptGemini,
  audioToSubtitleGemini,
  sanitizeGeminiModel,
  resolveApiModel,
  GEMINI_LIVE_MODELS
};
