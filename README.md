# nifael AI Subtitle

A high-performance, AI-powered subtitle translation add-on for [Stremio](https://www.stremio.com/). It searches multiple subtitle databases (OpenSubtitles, SubDL, and SubSource), cleans promotional watermarks and ads, and translates dialogue into your chosen target language using state-of-the-art AI engines.

---

## ✨ Features

- **🌐 Multi-Engine AI Translation**:
  - **Google Translate**: Fast, free, zero-configuration translation.
  - **Google Gemini**: High-context AI translation with custom model support (`gemini-1.5-flash`, `gemini-2.0-flash`, `gemini-2.5-flash`, etc.).
  - **OpenAI**: Precise dialogue translation powered by GPT models (`gpt-4o-mini`, `gpt-4o`, etc.).
  - **DeepL API**: Professional-grade translation accuracy with 1-to-1 subtitle alignment.
- **📚 Multi-Provider Subtitle Aggregation**:
  - **OpenSubtitles**: Built-in high-speed OpenSubtitles v3 endpoint, official OpenSubtitles.com VIP API key support, and public REST fallback.
  - **SubDL**: Subtitle search with automatic ZIP decompression.
  - **SubSource**: Direct SubSource API integration.
- **🧹 Automatic Ad & Watermark Cleaner**:
  - Intelligently filters out release group watermarks, casino sponsors, social media links, and website ads without stripping legitimate movie dialogue.
- **⚡ Parallel Translation Worker Pool**:
  - Translates full movie subtitles (1,500+ cues) concurrently in ~6-8 seconds.
- **💾 Fast In-Memory Caching**:
  - Caches rendered WebVTT subtitles (24h TTL) to serve subsequent requests in under 10ms.
- **🛡️ Robust Encoding & Compatibility**:
  - Automatically normalizes Windows-1252, ISO-8859, UTF-8, and UTF-16 character encodings into standard WebVTT (`text/vtt; charset=utf-8`).
  - Compatible with Stremio Desktop, Android TV, Mobile, and Stremio Web.

---

## 🚀 Quick Start

### 1. Running with Docker Compose (Recommended)

```bash
# Clone the repository
git clone <your-repo-url>
cd nifael-ai-subtitle

# Create environment configuration (optional)
cp .env.example .env

# Build and start container
docker compose up -d --build
```

### 2. Running Locally (Node.js)

**Requirements:** Node.js 18+

```bash
# Install dependencies
npm install

# Start the server
npm start
```

The configuration page will be accessible at `http://localhost:7000`.

---

## ⚙️ Configuration & Stremio Installation

1. Open the web interface at `http://localhost:7000` (or your reverse-proxied domain).
2. Choose your **Target Language** (Malay, English, Spanish, Indonesian, etc.).
3. Select your desired **Translation Engine** (Google Translate, Gemini, OpenAI, or DeepL).
4. (Optional) Provide your personal AI or Subtitle Provider API keys.
5. Click **Install to Stremio (App)** or **Open in Stremio Web**.

---

## 🐳 Docker Configuration

Sample `docker-compose.yml`:

```yaml
services:
  nifael-ai-subtitle:
    build: .
    container_name: nifael-ai-subtitle
    restart: unless-stopped
    env_file:
      - .env
    environment:
      - PORT=7000
    networks:
      - aiostreams_web
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=aiostreams_web"
      - "traefik.http.routers.nifael-subs.entrypoints=websecure"
      - "traefik.http.routers.nifael-subs.rule=Host(`aisubtitletranslation.yourdomain.com`)"
      - "traefik.http.routers.nifael-subs.tls.certresolver=letsencrypt"
      - "traefik.http.services.nifael-subs.loadbalancer.server.port=7000"

networks:
  aiostreams_web:
    external: true
```

---

## 📁 Project Structure

```
.
├── server.js              # Express server, Stremio routing & render API
├── manifest.js            # Stremio addon manifest definition
├── srtHelper.js           # SRT parser, ad cleaner & WebVTT generator
├── translator.js          # AI & machine translation dispatcher
├── cache.js               # NodeCache in-memory cache manager
├── providers/             # Subtitle provider search & download modules
│   ├── index.js           # Provider orchestrator & archive decompressor
│   ├── opensubtitles.js   # OpenSubtitles v3 & VIP integration
│   ├── subdl.js           # SubDL API integration
│   └── subsource.js       # SubSource API integration
├── public/                # Web configuration UI
│   └── index.html         # Addon configuration portal
├── Dockerfile             # Alpine-based production Dockerfile
└── docker-compose.yml     # Traefik & container deployment config
```

---

## 📄 License

This project is open-source and available under the [ISC License](LICENSE).
