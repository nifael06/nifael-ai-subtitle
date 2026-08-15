const axios = require("axios");
const zlib = require("zlib");
const AdmZip = require("adm-zip");
const iconv = require("iconv-lite");
const { fetchOpenSubtitles } = require("./opensubtitles");
const { fetchSubDL } = require("./subdl");
const { fetchSubSource } = require("./subsource");

/**
 * Clean and normalize IMDb ID (handles tt1234567, 1234567, tt1234567:1:1, etc.)
 */
function normalizeImdbId(rawId) {
  if (!rawId) return "";
  const str = String(rawId).trim();
  const idOnly = str.split(":")[0];
  const digits = idOnly.replace(/^tt/i, "");
  return digits ? `tt${digits}` : "";
}

/**
 * Fetch subtitles across all 3 providers with timeout isolation
 */
async function searchAllSubtitles(rawImdbId, season = null, episode = null, providerKeys = {}, type = "movie") {
  const imdbId = normalizeImdbId(rawImdbId);
  if (!imdbId) return [];

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
      console.warn(`[nifael AI] ${providerNames[index]} query finished without results:`, res.reason?.message || "Unavailable");
    }
  });

  return allSubs;
}

/**
 * Robust multi-encoding text decoder supporting UTF-8, UTF-16, and Windows legacy code pages
 */
function decodeSubtitleBuffer(buf) {
  if (!buf || buf.length === 0) return "";

  // UTF-8 BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString("utf8");
  }
  // UTF-16 LE BOM
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return iconv.decode(buf.slice(2), "utf16-le");
  }
  // UTF-16 BE BOM
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return iconv.decode(buf.slice(2), "utf16-be");
  }

  // Attempt UTF-8 first
  const utf8 = buf.toString("utf8");
  if (!utf8.includes("\ufffd")) {
    return utf8;
  }

  // Fallback candidate codepages
  const candidateEncodings = ["win1252", "win1256", "win1251", "win1255", "iso-8859-1"];
  for (const enc of candidateEncodings) {
    try {
      const decoded = iconv.decode(buf, enc);
      if (!decoded.includes("\ufffd")) {
        return decoded;
      }
    } catch {}
  }

  return utf8;
}

/**
 * Download subtitle with buffer validation & automatic .gz / .zip decompression
 */
async function downloadSubtitleText(downloadUrl) {
  if (!downloadUrl || typeof downloadUrl !== "string") return null;

  try {
    let actualUrl = downloadUrl;

    // Handle OpenSubtitles.com VIP download endpoint resolution
    if (downloadUrl.startsWith("https://api.opensubtitles.com/api/v1/download?")) {
      try {
        const urlObj = new URL(downloadUrl);
        const fileId = urlObj.searchParams.get("file_id");
        const apiKey = urlObj.searchParams.get("api_key");

        if (fileId && apiKey) {
          const dlRes = await axios.post(
            "https://api.opensubtitles.com/api/v1/download",
            { file_id: parseInt(fileId, 10) },
            {
              headers: {
                "Api-Key": apiKey,
                "User-Agent": "nifael-ai-subtitles v1.0.0"
              },
              timeout: 7000
            }
          );

          if (dlRes.data && dlRes.data.link) {
            actualUrl = dlRes.data.link;
          }
        }
      } catch (vipErr) {
        console.warn("[nifael AI] OpenSubtitles VIP link resolution warning:", vipErr.message);
      }
    }

    const response = await axios.get(actualUrl, {
      responseType: "arraybuffer",
      timeout: 8000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
      }
    });

    if (!response.data || response.data.byteLength === 0) {
      return null;
    }

    let buffer = Buffer.from(response.data);

    // 1. Handle GZIP compressed subtitles (.gz)
    if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
      try {
        buffer = zlib.gunzipSync(buffer);
      } catch (gzErr) {
        console.warn("[nifael AI] Gunzip error, using raw buffer:", gzErr.message);
      }
    }
    // 2. Handle ZIP archives (.zip) e.g. from SubDL
    else if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
      try {
        const zip = new AdmZip(buffer);
        const entries = zip.getEntries();
        const srtEntry =
          entries.find(
            (e) =>
              !e.isDirectory &&
              (e.entryName.toLowerCase().endsWith(".srt") || e.entryName.toLowerCase().endsWith(".vtt"))
          ) || entries.find((e) => !e.isDirectory);

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
  downloadSubtitleText,
  normalizeImdbId,
  decodeSubtitleBuffer
};
