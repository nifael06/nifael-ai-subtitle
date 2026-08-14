const manifest = {
  id: "com.nifael.ai.subtitles",
  version: "1.0.0",
  name: "nifael AI subtitle",
  description: "AI-powered subtitle translation from OpenSubtitles, SubDL, and SubSource to any language.",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
  behaviorHints: {
    configurable: true,
    configurationRequired: false
  }
};

module.exports = manifest;
