const axios = require("axios");
const zlib = require("zlib");
const AdmZip = require("adm-zip");
const iconv = require("iconv-lite");
const { fetchOpenSubtitles } = require("./opensubtitles");
const { fetchSubDL } = require("./subdl");
const { fetchSubSource } = require("./subsource");

/**
 * Fetch subtitles across all 3 providers with optional personal user keys
 */
async function searchAllSubtitles(imdbId, season = null, episode = null, providerKeys = {}, type = "movie") {
  console.log(`[nifael AI] Searching providers for ${imdbId} (S:${season || 0} E:${episode || 0})`);

  const results = await Promise.allSettled([
    fetchOpenSubtitles(imdbId, season, episode, providerKeys.osKey || "", type),
    fetchSubDL(imdbId, season, episode, providerKeys.subdlKey || ""),
    fetchSubSource(imdbId, season, episode, providerKeys.subsourceKey || "")
  ]);

  const allSubs = [];
  const providerNames = ["OpenSubtitles", "SubDL", "SubSource"];

  results.forEach((res, index) => {
    if (res.status === "fulfilled" && Array.isArray(res.value)) {
      console.log(`[nifael AI] Found ${res.value.length} subs from ${providerNames[index]}`);
      allSubs.push(...res.value);
    } else {
      console.error(`[nifael AI] Failed ${providerNames[index]}:`, res.reason?.message || "Unknown error");
    }
  });

  return allSubs;
}

/**
 * Robust text decoder supporting UTF-8, UTF-16, and Windows-1252/ISO-8859-1
 */
function decodeSubtitleBuffer(buf) {
  if (!buf || buf.length === 0) return "";

  // UTF-8 BOM
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString("utf8");
  }
  // UTF-16 LE BOM
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    return iconv.decode(buf.slice(2), "utf16-le");
  }
  // UTF-16 BE BOM
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    return iconv.decode(buf.slice(2), "utf16-be");
  }

  // Attempt UTF-8 first
  const utf8 = buf.toString("utf8");
  // If replacement character is present, fallback to Windows-1252 (CP1252)
  if (utf8.includes("\ufffd")) {
    try {
      const cp1252 = iconv.decode(buf, "win1252");
      return cp1252;
    } catch (e) {}
  }
  return utf8;
}

/**
 * Download subtitle and handle automatic .gz / .zip decompression & encoding
 */
async function downloadSubtitleText(downloadUrl) {
  try {
    let actualUrl = downloadUrl;
    let customHeaders = { "User-Agent": "TemporaryUserAgent" };

    // Handle OpenSubtitles.com VIP download endpoint resolution
    if (downloadUrl.startsWith("https://api.opensubtitles.com/api/v1/download?")) {
      const urlObj = new URL(downloadUrl);
      const fileId = urlObj.searchParams.get("file_id");
      const apiKey = urlObj.searchParams.get("api_key");

      const dlRes = await axios.post("https://api.opensubtitles.com/api/v1/download", {
        file_id: parseInt(fileId, 10)
      }, {
        headers: {
          "Api-Key": apiKey,
          "User-Agent": "nifael-ai-subtitles v1.0.0"
        },
        timeout: 8000
      });

      if (dlRes.data && dlRes.data.link) {
        actualUrl = dlRes.data.link;
      } else {
        throw new Error("Failed to obtain VIP download link from OpenSubtitles");
      }
    }

    const response = await axios.get(actualUrl, {
      responseType: "arraybuffer",
      timeout: 10000,
      headers: customHeaders
    });

    let buffer = Buffer.from(response.data);

    // 1. Handle GZIP compressed subtitles (.gz)
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
      buffer = zlib.gunzipSync(buffer);
    }
    // 2. Handle ZIP archives (.zip) e.g. from SubDL
    else if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
      try {
        const zip = new AdmZip(buffer);
        const entries = zip.getEntries();
        const srtEntry = entries.find(e =>
          !e.isDirectory &&
          (e.entryName.toLowerCase().endsWith(".srt") || e.entryName.toLowerCase().endsWith(".vtt"))
        ) || entries.find(e => !e.isDirectory);

        if (srtEntry) {
          buffer = srtEntry.getData();
        }
      } catch (zipErr) {
        console.warn("[nifael AI] Zip extraction warning:", zipErr.message);
      }
    }

    return decodeSubtitleBuffer(buffer);
  } catch (error) {
    console.error("[nifael AI] Error downloading subtitle content:", error.message);
    return null;
  }
}

module.exports = {
  searchAllSubtitles,
  downloadSubtitleText
};

