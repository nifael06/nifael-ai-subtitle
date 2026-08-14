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
  /vip members/i
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

// Helper to normalize timestamp string to standard HH:MM:SS,mmm format
function normalizeTimestamp(ts) {
  if (!ts) return "00:00:00,000";
  const [hms, ms] = ts.split(/[,.]/);
  const parts = hms.split(":");
  if (parts.length === 2) parts.unshift("00");
  const hh = parts[0].padStart(2, "0");
  const mm = parts[1].padStart(2, "0");
  const ss = parts[2].padStart(2, "0");
  const mss = (ms || "000").padEnd(3, "0").substring(0, 3);
  return `${hh}:${mm}:${ss},${mss}`;
}

// 1. Native zero-dependency SRT & VTT Parser
function parseSrt(srtContent) {
  if (!srtContent || typeof srtContent !== "string") return [];

  // Strip BOM and normalize line endings
  const normalized = srtContent
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const blocks = normalized.trim().split(/\n\s*\n/);
  const cues = [];

  blocks.forEach((block) => {
    const lines = block.trim().split("\n");
    if (lines.length >= 2) {
      let timeLineIndex = 1;

      // If line 0 contains the timestamp arrow
      if (lines[0].includes("-->")) {
        timeLineIndex = 0;
      }

      const timeLine = lines[timeLineIndex];
      const timeMatch = timeLine.match(/(\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3})/);

      if (timeMatch) {
        const startTime = normalizeTimestamp(timeMatch[1]);
        const endTime = normalizeTimestamp(timeMatch[2]);
        let text = lines.slice(timeLineIndex + 1).join("\n").trim();

        // Strip font and styling tags from cue text for cleaner translation
        text = text.replace(/<[^>]+>/g, "").replace(/\{[^}]+\}/g, "").trim();

        if (text) {
          cues.push({
            id: (cues.length + 1).toString(),
            startTime,
            endTime,
            text
          });
        }
      }
    }
  });

  return cues;
}

// 2. Filter out promotional and watermark cues without stripping movie dialogue
function cleanCues(cues) {
  const total = cues.length;
  const originalCount = cues.length;

  const cleaned = cues.filter((cue, index) => {
    const text = cue.text.trim();
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

  const reindexed = cleaned.map((cue, index) => ({
    ...cue,
    id: (index + 1).toString()
  }));

  const removedAds = originalCount - reindexed.length;
  if (removedAds > 0) {
    console.log(`[nifael AI] Removed ${removedAds} ad/watermark cues from subtitle.`);
  }

  return reindexed;
}

// 3. Convert cue array into standard WebVTT format
function cuesToVtt(cues) {
  let vtt = "WEBVTT\n\n";

  cues.forEach((cue) => {
    const startTime = cue.startTime.replace(",", ".");
    const endTime = cue.endTime.replace(",", ".");

    vtt += `${cue.id}\n`;
    vtt += `${startTime} --> ${endTime}\n`;
    vtt += `${cue.text}\n\n`;
  });

  return vtt;
}

module.exports = {
  parseSrt,
  cleanCues,
  cuesToVtt
};

