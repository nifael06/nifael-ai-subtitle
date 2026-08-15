# nifael AI Subtitle

A high-performance, AI-powered subtitle translation add-on for [Stremio](https://www.stremio.com/). It searches multiple subtitle databases (OpenSubtitles, SubDL, and SubSource), cleans promotional watermarks and ads, and translates dialogue into your chosen target language using state-of-the-art AI engines.

---

## ✨ Features

- **🌐 Multi-Engine AI Translation**:
  - **Google Translate**: Fast, free, zero-configuration translation.
  - **Microsoft Bing Translator**: Robust, free, datacenter-rate-limit resistant translation.
  - **Google Gemini & Gemini Live**: High-context AI translation and real-time multimodal audio-to-subtitle transcription (`gemini-3.5-live-translate-preview`, `gemini-3.5-flash-lite`, `gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.5-pro`, etc.).
  - **OpenAI**: Precise dialogue translation powered by GPT models (`gpt-4o-mini`, `gpt-4o`, etc.).
  - **DeepL API**: Professional-grade translation accuracy with 1-to-1 subtitle alignment.
- **📚 Multi-Provider Subtitle Aggregation**:
  - **OpenSubtitles**: Built-in high-speed OpenSubtitles v3 endpoint, official OpenSubtitles.com VIP API key support, and public REST fallback.
  - **SubDL**: Subtitle search with automatic ZIP decompression.
  - **SubSource**: Direct SubSource API integration.
- **🧹 Automatic Ad & Watermark Cleaner**:
  - Intelligently filters out release group watermarks, casino sponsors, social media links, and website ads without stripping legitimate movie dialogue.
- **🎬 Remote Embedded Subtitle Extraction**:
  - Direct on-the-fly streaming extraction of embedded subtitle tracks from remote video URLs using `ffmpeg` without full video download.
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

## 🎬 Embedded vs. External Subtitles Architecture

### 1. Stremio Addon Protocol Constraints
- **Standard Subtitle Discovery (`/subtitles/:type/:id.json`)**:
  - In the official Stremio Addon Protocol, when Stremio queries a Subtitle Addon, it sends **only** the media identifier (e.g., IMDb ID `tt37287335` or Kitsu ID) with season and episode numbers.
  - The client **does not** send the video stream URL or Debrid link to Subtitle Addons.
  - Consequently, standalone Subtitle Addons cannot extract embedded internal tracks (e.g. MKV/MP4 subtitle tracks) during standard discovery. Instead, they aggregate external subtitles from databases (**OpenSubtitles**, **SubDL**, and **SubSource**) matching the title and release.

### 2. Stream Addon Integration (`/api/translate-embedded`)
- **Direct Embedded Track Extraction**:
  - Stream Addons (such as [AIOStreams](https://github.com/viren070/aiostreams), MediaFusion, Torrentio wrappers, or custom Debrid proxies) have direct access to the resolved video stream URL.
  - They can call `/api/translate-embedded` to extract and translate internal MKV/MP4 subtitle tracks on the fly using `ffmpeg` without downloading the full video.

#### Endpoint Specification:
```http
GET /api/translate-embedded?videoUrl=<STREAM_URL>&targetLang=<LANG>&trackIndex=0&engine=<ENGINE>&apiKey=<KEY>&model=<MODEL>
```

#### Query Parameters:
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `videoUrl` | `string` | **Yes** | Direct HTTP/HTTPS stream URL of the video (MKV/MP4). |
| `targetLang` | `string` | No | Target ISO-639-1 language code (e.g., `ms`, `en`, `es`, `id`). Default: `en`. |
| `trackIndex` | `number` | No | Zero-based subtitle stream index (`0` for first subtitle track). Default: `0`. |
| `engine` | `string` | No | Translation engine (`google`, `gemini`, `openai`, `deepl`). Default: `google`. |
| `apiKey` | `string` | No | API key for Gemini, OpenAI, or DeepL. |
| `model` | `string` | No | Custom AI model name (e.g., `gemini-3.5-flash-lite`, `gpt-4o-mini`). |

#### Stream Addon Integration Example:
When returning streams in a Stream Addon, attach the translated embedded subtitle track to the stream object's `subtitles` array:

```javascript
{
  name: "AIOStreams [4K Debrid]",
  title: "Movie.2026.2160p.HDR.mkv",
  url: "https://debrid.example.com/stream/video.mkv",
  subtitles: [
    {
      id: "nifael_embedded_0",
      lang: "ms",
      label: "[nifael AI: GEMINI] 🎬 Built-in Subtitle (Track #1) [➔ MS]",
      url: "https://aisubtitletranslation.nifael06.site/api/translate-embedded?videoUrl=" + encodeURIComponent("https://debrid.example.com/stream/video.mkv") + "&targetLang=ms&engine=gemini&trackIndex=0"
    }
  ]
}
```

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
├── embeddedExtractor.js   # FFmpeg remote embedded subtitle track extractor
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
