const axios = require("axios");

/**
 * Fetch subtitles from SubSource API (requires API key)
 */
async function fetchSubSource(imdbId, season = null, episode = null, userApiKey = "") {
  try {
    const apiKey = userApiKey || process.env.SUBSOURCE_API_KEY || "";
    if (!apiKey) return []; // SubSource requires an API key

    let url = `https://api.subsource.net/api/v1/subtitles/search?imdb=${imdbId}&api_key=${apiKey}`;

    const response = await axios.get(url, {
      headers: { "User-Agent": "nifael-ai-subtitles v1.0.0" },
      timeout: 6000
    });

    if (!response.data || !response.data.subtitles) return [];

    const subs = response.data.subtitles.map((sub, index) => ({
      id: `subsource_${sub.id || index}`,
      source: "SubSource",
      lang: sub.language || sub.lang || "en",
      fileName: sub.release || sub.name || `SubSource_${index + 1}`,
      downloadUrl: sub.download_url || (sub.id ? `https://api.subsource.net/api/v1/subtitles/download/${sub.id}` : null)
    })).filter(s => s.downloadUrl);

    return subs.sort((a, b) => {
      const aIsEng = (a.lang === "en" || a.lang === "eng" || a.lang === "en-US") ? 1 : 0;
      const bIsEng = (b.lang === "en" || b.lang === "eng" || b.lang === "en-US") ? 1 : 0;
      return bIsEng - aIsEng;
    });
  } catch (error) {
    return [];
  }
}

module.exports = { fetchSubSource };

