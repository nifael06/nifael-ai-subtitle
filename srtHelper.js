// Universal ad, website, and watermark patterns
const STRICT_AD_PATTERNS = [
  /opensubtitles/i,
  /subdl/i,
  /subsource/i,
  /subscene/i,
  /addic7ed/i,
  /yify/i,
  /osdb\.link/i,
  /advertise your product/i,
  /contact .*? today/i,
  /best subtitles/i,
  /www\.[a-z0-9\-]+\.[a-z]{2,}/i,
  /https?:\/\//i,
  /telegram|discord\.gg|t\.me\//i,
  /watch online movies/i,
  /vip members/i,
  /slot\s*gacor|judi\s*online|bet\d+/i
];

// Context-dependent credit patterns (filtered if near beginning/end or structured like credits)
const CREDIT_PATTERNS = [
  /synced by/i,
  /sync and corrected by/i,
  /encoded by/i,
  /transcribed by/i,
  /captioning by/i,
  /subtitles by/i,
  /subtitle created by/i,
  /ripped by/i,
  /resync by/i,
  /downloaded from/i,
  /join us on/i
];

/**
 * Convert timestamp string (HH:MM:SS.mmm or MM:SS.mmm or with commas) to milliseconds
 */
function timeToMs(timeStr) {
  if (!timeStr) return 0;
  const cleanStr = String(timeStr).replace(",", ".").trim();
  const parts = cleanStr.split(":");
  if (parts.length === 3) {
    const h = parseFloat(parts[0]) || 0;
    const m = parseFloat(parts[1]) || 0;
    const s = parseFloat(parts[2]) || 0;
    return (h * 3600 + m * 60 + s) * 1000;
  } else if (parts.length === 2) {
    const m = parseFloat(parts[0]) || 0;
    const s = parseFloat(parts[1]) || 0;
    return (m * 60 + s) * 1000;
  }
  return (parseFloat(cleanStr) || 0) * 1000;
}

/**
 * Format timestamp strictly into WebVTT standard HH:MM:SS.mmm with dots
 */
function formatVttTimestamp(ts) {
  if (!ts) return "00:00:00.000";
  const clean = String(ts).replace(",", ".").trim().split(/\s+/)[0];
  const parts = clean.split(":");
  if (parts.length === 2) parts.unshift("00");
  const hh = String(parts[0] || "00").padStart(2, "0");
  const mm = String(parts[1] || "00").padStart(2, "0");
  const secParts = String(parts[2] || "00.000").split(".");
  const ss = String(secParts[0] || "00").padStart(2, "0");
  const mss = String(secParts[1] || "000").padEnd(3, "0").substring(0, 3);
  return `${hh}:${mm}:${ss}.${mss}`;
}

/**
 * Normalizes any timestamp string (SRT or WebVTT) to standard HH:MM:SS,mmm format
 */
function normalizeTimestamp(ts) {
  if (!ts || typeof ts !== "string") return "00:00:00,000";

  const cleanTs = ts.trim().split(/\s+/)[0];
  const match = cleanTs.match(/(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,\.](\d{1,3})/);
  if (!match) return "00:00:00,000";

  const hh = (match[1] || "00").padStart(2, "0");
  const mm = (match[2] || "00").padStart(2, "0");
  const ss = (match[3] || "00").padStart(2, "0");
  const ms = (match[4] || "000").padEnd(3, "0").substring(0, 3);

  return `${hh}:${mm}:${ss},${ms}`;
}

/**
 * Clean text from styling tags, ass formatting tags, and HTML entities
 */
function cleanTextContent(rawText) {
  if (!rawText || typeof rawText !== "string") return "";

  return rawText
    // Remove SSA/ASS override tags e.g. {\an8}, {\pos(100,200)}, {\fad(100,100)}
    .replace(/\{[^}]+\}/g, "")
    // Remove HTML/VTT tags e.g. <i>, </b>, <font color="...">, <c.yellow>, <v Voice>
    .replace(/<[^>]+>/g, "")
    // Decode HTML numeric decimal entities: &#1234;
    .replace(/&#(\d+);/g, (_, dec) => {
      try { return String.fromCharCode(parseInt(dec, 10)); } catch { return ""; }
    })
    // Decode HTML numeric hex entities: &#xABCD;
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try { return String.fromCharCode(parseInt(hex, 16)); } catch { return ""; }
    })
    // Decode common named HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/**
 * 1. Native zero-dependency, fault-tolerant SRT & WebVTT Parser
 * Supports standard multi-line SRT, WebVTT, and inline AI bracket formats [ 00:01:00,000 --> 00:01:05,000 ] Text
 */
function parseSrt(srtContent) {
  if (!srtContent || typeof srtContent !== "string") return [];

  // Strip UTF-8 BOM and normalize line endings
  const normalized = srtContent
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const cues = [];

  // 1. First attempt: Line-by-line parsing for inline AI format [ 00:16,569 --> 00:22,349 ] Dialogue
  const rawLines = normalized.split("\n");
  let hasInlineFormat = false;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line || line.startsWith("WEBVTT") || line.startsWith("NOTE")) continue;

    const inlineMatch = line.match(/^\[?\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[,\.]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[,\.]\d{1,3})\s*\]?\s*[:-]?\s*(.*)$/);
    if (inlineMatch && inlineMatch[3] && inlineMatch[3].trim()) {
      hasInlineFormat = true;
      const text = cleanTextContent(inlineMatch[3].trim());
      if (text) {
        cues.push({
          id: String(cues.length + 1),
          startTime: normalizeTimestamp(inlineMatch[1]),
          endTime: normalizeTimestamp(inlineMatch[2]),
          text
        });
      }
    }
  }

  if (hasInlineFormat && cues.length > 0) {
    cues.sort((a, b) => timeToMs(a.startTime) - timeToMs(b.startTime));
    return cues;
  }

  // 2. Standard multi-line block parsing
  const blocks = normalized.trim().split(/\n\s*\n/);

  for (let b = 0; b < blocks.length; b++) {
    const rawBlock = blocks[b].trim();
    if (!rawBlock) continue;

    if (rawBlock.startsWith("WEBVTT") || rawBlock.startsWith("NOTE") || rawBlock.startsWith("STYLE") || rawBlock.startsWith("REGION")) {
      continue;
    }

    const lines = rawBlock.split("\n").map(l => (typeof l === "string" ? l.trim() : ""));
    if (lines.length === 0) continue;

    let timeLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("-->")) {
        timeLineIndex = i;
        break;
      }
    }

    if (timeLineIndex !== -1) {
      const timeLine = lines[timeLineIndex];
      const timeMatch = timeLine.match(/((?:\d{1,2}:)?\d{1,2}:\d{2}[,\.]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[,\.]\d{1,3})/);

      if (timeMatch) {
        const startTime = normalizeTimestamp(timeMatch[1]);
        const endTime = normalizeTimestamp(timeMatch[2]);
        const textLines = lines.slice(timeLineIndex + 1);
        const text = cleanTextContent(textLines.join("\n"));

        if (text) {
          cues.push({
            id: String(cues.length + 1),
            startTime,
            endTime,
            text
          });
        }
      }
    }
  }

  // Pre-sort cues chronologically
  cues.sort((a, b) => timeToMs(a.startTime) - timeToMs(b.startTime));
  return cues;
}

/**
 * 2. Filter out promotional and watermark cues without stripping movie dialogue
 */
function cleanCues(cues) {
  const cueList = Array.isArray(cues) ? cues : (cues && Array.isArray(cues.cues) ? cues.cues : []);
  if (!cueList || cueList.length === 0) return [];

  const total = cueList.length;
  const originalCount = cueList.length;

  const cleaned = cueList.filter((cue, index) => {
    if (!cue || typeof cue !== "object") return false;
    const text = typeof cue.text === "string" ? cue.text.trim() : "";
    if (!text) return false;

    // 1. Check strict ad patterns anywhere in the subtitle
    if (STRICT_AD_PATTERNS.some((pattern) => pattern.test(text))) {
      return false;
    }

    // 2. Check credit patterns on boundary cues (first 6 or last 6 cues)
    const isBoundary = index < 6 || index > total - 7;
    if (isBoundary && CREDIT_PATTERNS.some((pattern) => pattern.test(text))) {
      return false;
    }

    return true;
  });

  // Re-sort and re-index
  cleaned.sort((a, b) => timeToMs(a.startTime) - timeToMs(b.startTime));

  const reindexed = cleaned.map((cue, index) => ({
    id: String(index + 1),
    startTime: cue.startTime || "00:00:00,000",
    endTime: cue.endTime || "00:00:00,000",
    text: cue.text || ""
  }));

  const removedAds = originalCount - reindexed.length;
  if (removedAds > 0) {
    console.log(`[nifael AI] Filtered ${removedAds} ad/watermark cues from subtitle.`);
  }

  return reindexed;
}

/**
 * Format timestamp strictly into SubRip SRT standard HH:MM:SS,mmm with commas
 */
function formatSrtTimestamp(ts) {
  if (!ts) return "00:00:00,000";
  const clean = String(ts).replace(".", ",").trim().split(/\s+/)[0];
  const parts = clean.split(":");
  if (parts.length === 2) parts.unshift("00");
  const hh = String(parts[0] || "00").padStart(2, "0");
  const mm = String(parts[1] || "00").padStart(2, "0");
  const secParts = String(parts[2] || "00,000").split(",");
  const ss = String(secParts[0] || "00").padStart(2, "0");
  const mss = String(secParts[1] || "000").padEnd(3, "0").substring(0, 3);
  return `${hh}:${mm}:${ss},${mss}`;
}

/**
 * 3. Convert cue array into standard WebVTT format with Strict Chronological Timestamp Sorting
 */
function cuesToVtt(cues) {
  let vtt = "WEBVTT\n\n";
  const cueList = Array.isArray(cues) ? [...cues] : (cues && Array.isArray(cues.cues) ? [...cues.cues] : []);
  if (cueList.length === 0) return vtt;

  // Strict Chronological Timestamp Sorting
  cueList.sort((a, b) => timeToMs(a?.startTime || a?.start) - timeToMs(b?.startTime || b?.start));

  cueList.forEach((cue, index) => {
    if (!cue) return;
    const start = formatVttTimestamp(cue.startTime || cue.start);
    const end = formatVttTimestamp(cue.endTime || cue.end);
    const text = typeof cue.text === "string" ? cue.text : "";
    const id = String(index + 1);

    vtt += `${id}\n`;
    vtt += `${start} --> ${end}\n`;
    vtt += `${text}\n\n`;
  });

  return vtt;
}

/**
 * 4. Convert cue array into standard SubRip (.SRT) format
 */
function cuesToSrt(cues) {
  let srt = "";
  const cueList = Array.isArray(cues) ? [...cues] : (cues && Array.isArray(cues.cues) ? [...cues.cues] : []);
  if (cueList.length === 0) return "";

  cueList.sort((a, b) => timeToMs(a?.startTime || a?.start) - timeToMs(b?.startTime || b?.start));

  cueList.forEach((cue, index) => {
    if (!cue) return;
    const start = formatSrtTimestamp(cue.startTime || cue.start);
    const end = formatSrtTimestamp(cue.endTime || cue.end);
    const text = typeof cue.text === "string" ? cue.text.trim() : "";
    const id = String(index + 1);

    srt += `${id}\n${start} --> ${end}\n${text}\n\n`;
  });

  return srt.trim() + "\n";
}

module.exports = {
  parseSrt,
  cleanCues,
  cuesToVtt,
  cuesToSrt,
  timeToMs,
  formatVttTimestamp,
  formatSrtTimestamp,
  normalizeTimestamp,
  cleanTextContent
};
