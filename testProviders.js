const { searchAllSubtitles, downloadSubtitleText } = require("./providers");
const { parseSrt, cleanCues, cuesToVtt } = require("./srtHelper");
const { translateCues } = require("./translator");

async function test() {
  console.log("--- 1. Testing Subtitle Providers Search ---");
  const subs = await searchAllSubtitles("tt0111161", null, null, {}, "movie");
  console.log(`Found ${subs.length} total subtitles!`);

  if (subs.length > 0) {
    const targetSub = subs.find(s => s.downloadUrl && s.lang === "eng") || subs[0];
    console.log("Top selected subtitle:", targetSub);

    console.log("\n--- 2. Testing Subtitle Download & Decompression ---");
    const rawSrt = await downloadSubtitleText(targetSub.downloadUrl);
    console.log(`Downloaded ${rawSrt ? rawSrt.length : 0} characters.`);

    console.log("\n--- 3. Testing SRT Parser & Ad Cleaner ---");
    const rawCues = parseSrt(rawSrt);
    const cleanedCues = cleanCues(rawCues);
    console.log(`Parsed ${rawCues.length} cues, cleaned to ${cleanedCues.length} cues.`);

    console.log("\n--- 4. Testing Translation & WebVTT Generation (first 5 cues) ---");
    const result = await translateCues(cleanedCues.slice(0, 5), "ms", "google");
    const vtt = cuesToVtt(result.cues);
    console.log("Generated WebVTT output:\n" + vtt);
  }
}

test();

