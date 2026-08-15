const { exec } = require("child_process");

/**
 * Streaming subtitle extractor using ffmpeg directly from remote video URLs
 */
function extractEmbeddedSubtitle(videoStreamUrl, trackIndex = 0) {
  return new Promise((resolve) => {
    if (!videoStreamUrl || typeof videoStreamUrl !== "string") {
      return resolve(null);
    }

    const safeTrack = isNaN(parseInt(trackIndex, 10)) ? 0 : Math.max(0, parseInt(trackIndex, 10));
    // Sanitize stream URL against command break-out
    const sanitizedUrl = videoStreamUrl.replace(/"/g, '\\"');
    const command = `ffmpeg -hide_banner -loglevel error -i "${sanitizedUrl}" -map 0:s:${safeTrack} -c:s srt -f srt -`;

    exec(command, { maxBuffer: 1024 * 1024 * 10, timeout: 30000 }, (error, stdout) => {
      if (error || !stdout || typeof stdout !== "string" || !stdout.trim()) {
        return resolve(null);
      }
      resolve(stdout);
    });
  });
}

/**
 * Extract a lightweight MP3 audio chunk from remote video URL for multimodal AI transcription
 */
function extractAudioChunk(videoStreamUrl, startTime = "00:00:00", duration = 600) {
  return new Promise((resolve) => {
    if (!videoStreamUrl || typeof videoStreamUrl !== "string") {
      return resolve(null);
    }

    const safeDuration = isNaN(parseInt(duration, 10)) ? 600 : Math.min(1800, Math.max(10, parseInt(duration, 10)));
    const sanitizedUrl = videoStreamUrl.replace(/"/g, '\\"');
    const safeStart = typeof startTime === "string" && startTime.trim() ? startTime.trim() : "00:00:00";

    const command = `ffmpeg -hide_banner -loglevel error -ss "${safeStart}" -i "${sanitizedUrl}" -t ${safeDuration} -vn -acodec libmp3lame -b:a 64k -ar 16000 -f mp3 -`;

    exec(command, { encoding: "buffer", maxBuffer: 1024 * 1024 * 30, timeout: 60000 }, (error, stdout) => {
      if (error || !stdout || stdout.length === 0) {
        if (error) console.warn("[nifael AI] extractAudioChunk error:", error.message);
        return resolve(null);
      }
      resolve(stdout.toString("base64"));
    });
  });
}

module.exports = {
  extractEmbeddedSubtitle,
  extractAudioChunk
};
