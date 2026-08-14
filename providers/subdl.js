const axios = require("axios");

/**
 * Fetch subtitles from SubDL API (uses optional user key if provided)
 */
async function fetchSubDL(imdbId, season = null, episode = null, userApiKey = "") {
  try {
    const apiKey = userApiKey || process.env.SUBDL_API_KEY || "";
    if (!apiKey) return []; // SubDL requires an API key

    let url = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${apiKey}`;
    
    if (season && episode) {
      url += `&season_number=${season}&episode_number=${episode}`;
    }

    const response = await axios.get(url, {
      headers: { "User-Agent": "nifael-ai-subtitles v1.0.0" },
      timeout: 6000
    });

    if (!response.data || !response.data.subtitles) {
      return [];
    }

    const subs = response.data.subtitles.map((sub, index) => {
      const dlUrl = sub.url ? (sub.url.startsWith("http") ? sub.url : `https://dl.subdl.com${sub.url}`) : null;
      return {
        id: `subdl_${sub.id || index}`,
        source: "SubDL",
        lang: sub.lang || sub.language || "en",
        fileName: sub.release_name || sub.name || `SubDL Subtitle ${index + 1}`,
        downloadUrl: dlUrl
      };
    }).filter(s => s.downloadUrl);

    return subs.sort((a, b) => {
      const aIsEng = (a.lang === "en" || a.lang === "eng" || a.lang === "en-US") ? 1 : 0;
      const bIsEng = (b.lang === "en" || b.lang === "eng" || b.lang === "en-US") ? 1 : 0;
      return bIsEng - aIsEng;
    });
  } catch (error) {
    // Graceful fallback if SubDL is unreachable
    return [];
  }
}

module.exports = { fetchSubDL };

