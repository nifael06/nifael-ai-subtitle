const { execFile } = require("child_process");

/**
 * Streaming subtitle extractor using ffmpeg directly from remote video URLs
 */
function extractEmbeddedSubtitle(videoStreamUrl, trackIndex = 0) {
  return new Promise((resolve) => {
    if (!videoStreamUrl || typeof videoStreamUrl !== "string") {
      return resolve(null);
    }

    const safeTrack = isNaN(parseInt(trackIndex, 10)) ? 0 : Math.max(0, parseInt(trackIndex, 10));
    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-i", videoStreamUrl,
      "-map", `0:s:${safeTrack}`,
      "-c:s", "srt",
      "-f", "srt",
      "-"
    ];

    execFile("ffmpeg", args, { maxBuffer: 1024 * 1024 * 10, timeout: 30000 }, (error, stdout) => {
      if (error || !stdout || typeof stdout !== "string" || !stdout.trim()) {
        return resolve(null);
      }
      resolve(stdout);
    });
  });
}

/**
 * Extract a lightweight MP3 audio stream from remote video URL for multimodal AI transcription
 * If duration is null / 0 / "full", extracts the entire video's audio from start to finish!
 */
function extractAudioChunk(videoStreamUrl, startTime = "00:00:00", duration = null) {
  return new Promise((resolve) => {
    if (!videoStreamUrl || typeof videoStreamUrl !== "string") {
      return resolve(null);
    }

    const safeStart = typeof startTime === "string" && startTime.trim() ? startTime.trim() : "00:00:00";
    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      "-reconnect", "1",
      "-reconnect_at_eof", "1",
      "-reconnect_streamed", "1",
      "-reconnect_delay_max", "2"
    ];

    if (safeStart !== "00:00:00") {
      args.push("-ss", safeStart);
    }

    args.push("-i", videoStreamUrl);

    if (duration && !isNaN(parseInt(duration, 10)) && parseInt(duration, 10) > 0) {
      args.push("-t", String(parseInt(duration, 10)));
    }

    args.push(
      "-vn",
      "-acodec", "libmp3lame",
      "-b:a", "64k",
      "-ar", "16000",
      "-f", "mp3",
      "-"
    );

    execFile("ffmpeg", args, { encoding: "buffer", maxBuffer: 1024 * 1024 * 150, timeout: 60000 }, (error, stdout) => {
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
