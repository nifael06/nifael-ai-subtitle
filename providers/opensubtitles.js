const axios = require("axios");

/**
 * Prioritize English source subtitles for higher translation fidelity
 */
function sortSubtitles(subs) {
  if (!Array.isArray(subs)) return [];
  return subs.sort((a, b) => {
    const aIsEng = (a?.lang === "en" || a?.lang === "eng" || a?.lang === "en-US") ? 1 : 0;
    const bIsEng = (b?.lang === "en" || b?.lang === "eng" || b?.lang === "en-US") ? 1 : 0;
    return bIsEng - aIsEng;
  });
}

/**
 * Fetch subtitles from OpenSubtitles (VIP API Key, Stremio v3, and REST fallback)
 */
async function fetchOpenSubtitles(rawImdbId, season = null, episode = null, userApiKey = "", type = "movie") {
  const imdbStr = String(rawImdbId || "").trim();
  const cleanImdb = imdbStr.replace(/^tt/i, "").split(":")[0];
  const fullImdb = `tt${cleanImdb}`;

  if (!cleanImdb) return [];

  // 1. If user provided their own OpenSubtitles.com API Key
  if (userApiKey) {
    try {
      let url = `https://api.opensubtitles.com/api/v1/subtitles?imdb_id=${cleanImdb}`;
      if (season && episode) url += `&season_number=${season}&episode_number=${episode}`;

      const res = await axios.get(url, {
        headers: {
          "Api-Key": userApiKey,
          "User-Agent": "nifael-ai-subtitles v1.0.0"
        },
        timeout: 6000
      });

      if (res.data && Array.isArray(res.data.data)) {
        const subs = res.data.data
          .map((item) => {
            const file = item.attributes?.files?.[0];
            const fileId = file ? file.file_id : null;
            return {
              id: `os_${fileId || item.id}`,
              source: "OpenSubtitles",
              lang: item.attributes?.language || "en",
              fileName: item.attributes?.release || item.attributes?.feature_details?.movie_name || "OpenSubtitles VIP",
              downloadUrl: fileId
                ? `https://api.opensubtitles.com/api/v1/download?file_id=${fileId}&api_key=${encodeURIComponent(userApiKey)}`
                : null
            };
          })
          .filter((s) => s.downloadUrl);

        if (subs.length > 0) return sortSubtitles(subs);
      }
    } catch (e) {
      console.warn("[OpenSubtitles VIP error, falling back to public]:", e.message);
    }
  }

  // 2. Primary Free Public: Stremio OpenSubtitles v3 Endpoint
  try {
    const isSeries = Boolean(season && episode);
    const mediaType = isSeries ? "series" : (type || "movie");
    const queryId = isSeries ? `${fullImdb}:${season}:${episode}` : fullImdb;
    const v3Url = `https://opensubtitles-v3.strem.io/subtitles/${mediaType}/${queryId}.json`;

    const v3Res = await axios.get(v3Url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
      },
      timeout: 7000
    });

    if (v3Res.data && Array.isArray(v3Res.data.subtitles) && v3Res.data.subtitles.length > 0) {
      const subs = v3Res.data.subtitles
        .map((item, index) => ({
          id: `os_${item.id || index}`,
          source: "OpenSubtitles",
          lang: item.lang || "en",
          fileName: `OpenSubtitles (${item.lang ? item.lang.toUpperCase() : "EN"}) #${index + 1}`,
          downloadUrl: item.url
        }))
        .filter((s) => s.downloadUrl);

      if (subs.length > 0) return sortSubtitles(subs);
    }
  } catch (v3Err) {
    console.warn("[OpenSubtitles v3 error, falling back to REST]:", v3Err.message);
  }

  // 3. Secondary Free Fallback: rest.opensubtitles.org
  try {
    let publicUrl = `https://rest.opensubtitles.org/search/imdbid-${cleanImdb}`;
    if (season && episode) publicUrl += `/season-${season}/episode-${episode}`;

    const response = await axios.get(publicUrl, {
      headers: { "User-Agent": "TemporaryUserAgent" },
      timeout: 6000
    });

    if (Array.isArray(response.data)) {
      const subs = response.data
        .filter((item) => item && item.SubDownloadLink)
        .map((item, index) => ({
          id: `os_${item.IDSubtitleFile || index}`,
          source: "OpenSubtitles",
          lang: item.SubLanguageID || item.ISO639 || "en",
          fileName: item.MovieReleaseName || item.SubFileName || `OpenSubtitles_${index + 1}`,
          downloadUrl: item.SubDownloadLink
        }));

      return sortSubtitles(subs);
    }
  } catch (error) {
    console.warn("[OpenSubtitles REST error]:", error.message);
  }

  return [];
}

module.exports = { fetchOpenSubtitles };
