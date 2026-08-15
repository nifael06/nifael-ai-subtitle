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

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const prompt = `You are a real-time ultra-fast subtitle translation engine. Translate the following subtitle batch into language '${targetLang}'. Keep all '<<<SEG>>>' and '---SEG---' delimiters verbatim between subtitle lines. Return ONLY the translated subtitle lines:\n\n${textBatch}`;

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
 * 2. Multimodal Audio-to-Subtitle transcription and live translation
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
    primaryApiModel,
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.6-flash",
    "gemini-3.7-flash",
    "gemini-3.5-pro",
    "gemini-3.7-pro"
  ].filter((m, idx, arr) => m && arr.indexOf(m) === idx);

  let lastError = null;

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const promptText = `You are an expert audio transcriber and movie subtitle generator. Listen to the provided audio stream, transcribe all spoken dialogue accurately with precise timestamps, and translate the dialogue directly into language '${targetLang}'. Output ONLY valid SubRip (SRT) format with cue numbers and timestamps (HH:MM:SS,mmm --> HH:MM:SS,mmm). Do not add explanations, notes, or markdown backticks:`;

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
          generationConfig: { temperature: 0.2 },
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

      console.error("[Gemini Audio-to-Subtitle Error]:", errorMsg);
      throw error;
    }
  }

  if (lastError) throw lastError;
  return "";
}

module.exports = {
  streamTranslateGemini,
  audioToSubtitleGemini,
  sanitizeGeminiModel,
  GEMINI_LIVE_MODELS
};
