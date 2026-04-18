# Mwongozo

**AI Navigation Companion for East African Enterprise Portals**

Mwongozo ("guide" in Swahili) is an embeddable AI assistant that helps employees and citizens navigate government and banking portals. It surfaces as a floating orb widget, listens via voice or text, and responds in Swahili/English with step-by-step guidance — pointing directly at UI elements using Computer Vision.

---

## What's inside

| Package | Description |
|---------|-------------|
| `proxy/` | Node.js API proxy — multi-tenant, streams Claude/GLM responses, RAG, analytics |
| `sdk/` | Vanilla JS web widget (Shadow DOM, zero dependencies) + React wrapper |
| `desktop/` | Electron companion app — always-on-top orb with voice, TTS, screen capture |
| `dashboard/` | Single-file admin UI — analytics, knowledge base, document management |
| `nginx/` | Reverse-proxy config to sit in front of the proxy |

---

## Quick start

### 1. Configure environment

```bash
cp proxy/.env.example proxy/.env
# Fill in at least OPENROUTER_API_KEY
```

<details>
<summary>All environment variables</summary>

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes (or BigModel) | Access Claude, GPT-4, Llama via OpenRouter |
| `BIGMODEL_API_KEY` | No | For GLM-5V-Turbo (cheaper high-volume option) |
| `ELEVENLABS_API_KEY` | No | ElevenLabs text-to-speech |
| `ELEVENLABS_VOICE_ID` | No | ElevenLabs voice (defaults to a neutral English voice) |
| `ASSEMBLYAI_API_KEY` | No | AssemblyAI speech-to-text transcription |
| `ADMIN_SECRET` | Recommended | Protects `/admin/*` endpoints; leave empty in dev |
| `PORT` | No | Proxy port (default: `8787`) |

</details>

### 2. Start the proxy

```bash
cd proxy
node server.js
# Proxy listening at http://localhost:8787
```

Health-check: `GET http://localhost:8787/health` → `{"status":"ok"}`

### 3. Embed the web widget

**Option A — CDN / script tag (no build step)**

```html
<!-- In your portal's <head> or before </body> -->
<script
  src="http://localhost:8787/widget.js"
  data-org="tra"
  data-proxy="http://localhost:8787"
  data-position="bottom-right"
  defer
></script>
```

That's it. The widget auto-initialises, loads your org's branding from `/config?org=tra`, and mounts the floating orb.

**Option B — programmatic JS**

```html
<script src="http://localhost:8787/widget.js"></script>
<script>
  window.MwongozoSDK.init({
    orgId:    'tra',
    proxyUrl: 'http://localhost:8787',
    position: 'bottom-right',
  });
</script>
```

**Option C — React / TypeScript**

```bash
npm install @mwongozo/react
```

```tsx
import { MwongozoWidget } from '@mwongozo/react'

export default function App() {
  return (
    <>
      {/* your app */}
      <MwongozoWidget
        orgId="tra"
        proxyUrl="https://your-proxy.example.com"
        position="bottom-right"
      />
    </>
  )
}
```

#### `useMwongozo` hook

```tsx
import { useMwongozo } from '@mwongozo/react'

function SearchButton() {
  const { ask, state } = useMwongozo()
  return (
    <button onClick={() => ask('How do I file a VAT return?')} disabled={state !== 'idle'}>
      Ask Msaada
    </button>
  )
}
```

---

## Desktop app

The desktop companion is an Electron app that sits in the system tray, shows a floating orb (bottom-right), and answers questions about whatever is on screen.

### Development

```bash
cd desktop
npm install
npm run dev          # starts Electron + Vite hot reload
```

### Production build

```bash
npm run build        # compile TypeScript + Vite
npm run package      # electron-builder → dist/ (installers for current platform)
```

### Configuration

On first run the app stores settings in `~/.mwongozo/`:

| Setting | How to change |
|---------|---------------|
| **Proxy URL** | Open panel → Settings tab → Proxy URL |
| **Org ID** | Open panel → Settings tab → Org ID |
| **Orb colour / size / personality** | Open panel → Settings tab → Orb |
| **Hotkey** | Default `Alt+Shift+A` — hold to speak, release to submit |

### How it works

1. Press and hold the global hotkey.
2. Speak your question — the orb turns red ("● REC").
3. Release — the app transcribes via AssemblyAI (or falls back to Web Speech API).
4. Claude streams a response to the panel _and_ a floating bubble near your cursor.
5. ElevenLabs (or OS TTS) reads the answer aloud.
6. The orb's animated cursor points to the exact UI element you need to click.

---

## Admin dashboard

Open `dashboard/index.html` in a browser (no build needed):

```
file:///path/to/click/dashboard/index.html
```

Or serve it via nginx (already configured in `nginx/nginx.conf` under `/admin`).

**Tabs:**

| Tab | What you can do |
|-----|-----------------|
| Overview | Live stats: conversations, top questions, active pages |
| Conversations | Browse recent chats, click any row for full transcript |
| Knowledge Base | Edit the org system prompt and welcome message |
| Documents | Upload text documents for RAG (retrieved and injected into context) |
| Settings | Set the proxy URL and admin secret |

Set the `X-Admin-Secret` header (or `?secret=` query param in dev) to authenticate.

---

## Adding or editing an org

Each org is a JSON file in `proxy/orgs/`. Copy an existing one:

```bash
cp proxy/orgs/tra.json proxy/orgs/myorg.json
```

```jsonc
{
  "id": "myorg",
  "name": "MyOrg Msaada",
  "fullName": "My Organisation Help Desk",
  "theme": "#1a73e8",            // orb + widget accent colour (hex)
  "language": "sw-en",           // "sw-en" | "en" | "sw"
  "allowedOrigins": [            // CORS: empty array = allow all (dev only)
    "https://portal.myorg.go.tz"
  ],
  "systemPrompt": "You are a helpful assistant for MyOrg...",
  "welcomeMessage": "Habari! I am the MyOrg assistant.",
  "roles": {
    "employee": "Extra instructions when the user is a staff member.",
    "customer": "Extra instructions when the user is a customer."
  },
  "suggestedQuestions": [
    "How do I register?",
    "What documents do I need?"
  ]
}
```

The proxy picks up the file automatically — no restart needed (org configs are hot-cached per request).

---

## Docker deployment

```bash
# Copy and fill in your keys
cp proxy/.env.example proxy/.env

# Build and start proxy + nginx
docker compose up -d

# View logs
docker compose logs -f proxy
```

**What runs:**

| Container | Port | Service |
|-----------|------|---------|
| `proxy` | 8787 | Node.js API proxy |
| `nginx` | 80 | Reverse proxy + widget CDN |

The widget is served from nginx at `/widget.js`. Update your script tags to use port 80 in production.

---

## Building the SDK

```bash
cd sdk
npm install
npm run build         # → dist/widget.js (minified, production)
npm run build:dev     # → dist/widget.dev.js (with source maps)
npm run watch         # watch mode for local development
```

To deploy a new widget version, copy `dist/widget.js` into the nginx static files directory (`/var/www/html/` by default) or configure nginx to proxy `/widget.js` to the SDK dist folder.

---

## API reference

All endpoints require the `X-Org-Id` header (or `?org=` query param on GET endpoints).

### Public

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/health` | — | Health check → `{"status":"ok"}` |
| `GET` | `/config?org=tra` | — | Org branding (name, theme, welcome message) |
| `POST` | `/chat` | `{messages, model, stream}` | Stream Claude / GLM response (SSE) |
| `POST` | `/tts` | `{text, lang}` | ElevenLabs TTS → `audio/mpeg` |
| `POST` | `/transcribe` | raw audio bytes | AssemblyAI STT → `{text}` |
| `POST` | `/log` | `{role, text, page, …}` | Log a conversation turn |

### Admin (requires `X-Admin-Secret` header)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/analytics?org=tra` | Summary stats |
| `GET` | `/admin/conversations?org=tra&limit=50` | Recent conversations |
| `GET/POST` | `/admin/knowledge?org=tra` | Read or update system prompt |
| `GET` | `/admin/documents?org=tra` | List RAG documents |
| `POST` | `/admin/documents?org=tra` | Upload document (text body or `{filename, text}` JSON) |
| `DELETE` | `/admin/documents?org=tra&id=<id>` | Remove document |

---

## Architecture

```
Browser / Desktop
      │
      ▼
  ┌─────────┐     SSE stream    ┌───────────────────────┐
  │  Widget  │ ◄──────────────► │  Proxy (port 8787)    │
  │  (SDK)   │  JSON REST        │  • CORS per org        │
  └─────────┘                   │  • RAG (TF-IDF)        │
                                 │  • Analytics           │
  ┌──────────┐                   │  • Rate limiting       │
  │ Desktop  │ ◄──────────────► │                        │
  │(Electron)│                   └───────────┬───────────┘
  └──────────┘                               │
                                   ┌─────────┴──────────┐
                              OpenRouter              ElevenLabs
                           (Claude / GPT-4)         AssemblyAI
```

---

## Planned features

The following improvements are on the roadmap:

- **Rate limiting** — per-IP and per-org request throttling in the proxy to prevent abuse
- **WebSocket transport** — replace SSE with a persistent WebSocket for lower latency on mobile
- **Plugin API** — `window.mwongozo.registerPlugin(fn)` so host pages can inject custom context
- **Offline mode** — cache the last 5 responses in IndexedDB so answers are available without connectivity
- **SAML / OAuth SSO** — detect logged-in user identity from standard SSO cookies automatically
- **Multi-language TTS** — route ElevenLabs voice selection per language (Swahili vs English voice)
- **Dark / light auto-theme** — detect `prefers-color-scheme` and adjust panel colours accordingly
- **Accessibility** — full keyboard navigation for the widget panel, ARIA live regions for streamed text
- **Analytics export** — CSV/JSON export from the admin dashboard
- **Cloudflare D1 persistence** — replace file-based analytics with Cloudflare D1 for the Workers deployment

---

## Development notes

### Project layout

```
click/
├── sdk/
│   ├── src/
│   │   ├── index.js       # auto-init entry point (script tag)
│   │   ├── widget.js      # MwongozoWidget orchestrator
│   │   ├── orb.js         # floating orb (Shadow DOM, rAF animations)
│   │   ├── panel.js       # chat panel UI
│   │   ├── chat.js        # SSE streaming client
│   │   ├── audio.js       # mic recording + TTS playback
│   │   ├── context.js     # page-context extractor
│   │   ├── auth.js        # user-identity detection
│   │   ├── highlighter.js # DOM element highlight/guide
│   │   ├── i18n.js        # Swahili / English strings
│   │   └── markdown.js    # lightweight response formatter
│   └── react/             # @mwongozo/react TypeScript wrapper
├── proxy/
│   ├── server.js          # HTTP server (~600 lines, no framework)
│   ├── rag.js             # TF-IDF retrieval
│   ├── analytics.js       # in-memory + file-backed analytics
│   └── orgs/              # per-org JSON configs
├── desktop/
│   └── src/
│       ├── main/          # Electron main process
│       ├── preload/       # context-bridge API
│       ├── renderer/      # orb / panel / overlay React apps
│       ├── services/      # claude.ts, tts.ts, transcription.ts
│       └── shared/        # ipc.ts, types.ts
└── dashboard/
    └── index.html         # single-file admin UI
```

### Coding conventions

- **No framework in the proxy** — plain `node:http`, keeps the cold-start fast on Cloudflare Workers.
- **Shadow DOM in the SDK** — prevents host-page CSS from leaking into the widget.
- **IPC channel registry** — all Electron IPC channels are defined once in `desktop/src/shared/ipc.ts`.
- **File-based storage** — org configs, analytics, and RAG indexes live on disk; no database to provision.

### Running tests

There are no automated tests yet — contributions welcome. Manual smoke-test flow:

1. Start the proxy: `cd proxy && node server.js`
2. Open `sdk/demo/index.html` in a browser (or serve it on any local server)
3. Ask a question via the widget and verify the response streams correctly
4. Check `proxy/analytics.json` to confirm the event was logged

---

## License

MIT — see [LICENSE](./LICENSE).
