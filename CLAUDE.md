# CLICK— AI Navigation Companion for East African Business Portals

> *CLick* . This is an AI-powered screen companion that helps
> employees and clients navigate government portals (TRA IDARS, BRELA, ZSSF, NHIF, etc.)
> and business software — reducing onboarding time and training costs for Tanzanian companies.
>
> **Built on top of [farzaa/clicky](https://github.com/farzaa/clicky)** — a macOS push-to-talk
> AI screen companion. We are forking it, converting it to Electron for cross-platform
> (Windows-first) support, replacing proprietary APIs with open-source models, and adding
> a full multi-tenant SaaS layer with company onboarding codes and analytics.

---

## 🚀 First Thing To Do

```bash
# 1. Clone the upstream Clicky repo as the base
git clone https://github.com/farzaa/clicky.git .

# 2. Read this file fully before touching anything
# 3. Follow the phased build plan below — do NOT jump ahead
```

---

## Product Vision

A company (e.g. an accounting firm) signs up on the Mwongozo web dashboard.
They get an **org code** (e.g. `KPMG-TZ-4829`). Their staff download the desktop app,
enter the code, and instantly get a customized AI companion that:

- Watches their screen
- Guides them through TRA VAT filing, BRELA registrations, ZSSF contributions, etc.
- Speaks instructions in Swahili or English
- Points at the exact button or field they need to click
- Tracks every session for the company admin to review

The firm can also generate **client codes** for the companies they serve — so their
accounting clients get the same guided experience for their own portals.

---

## Target Platform

**Windows first.** Most Tanzanian office computers run Windows. Clicky is macOS-only (Swift).
We are rebuilding the desktop layer in **Electron + TypeScript + React** so it runs on
Windows, macOS, and Linux from one codebase.

---

## Tech Stack

### Desktop App (Electron)
| Layer | Technology | Why |
|---|---|---|
| Shell | Electron 28+ | Cross-platform, screen capture, system tray, overlays |
| UI | React 18 + TypeScript | Component reuse with web dashboard |
| Styling | Tailwind CSS | Fast, consistent |
| State | Zustand | Lightweight, works well with Electron IPC |
| Screen Capture | Electron `desktopCapturer` | Built-in, no extra deps |
| Overlay | Electron `BrowserWindow` (transparent) | Mimics Clicky's NSPanel overlay |
| Hotkey | `iohook` or `electron-shortcut` | Global push-to-talk |
| Build | `electron-builder` | Packaging for Windows/macOS |

### AI / Models (Open Source First — Cost Priority)
| Task | Primary (Free/Cheap) | Fallback |
|---|---|---|
| Screen vision + guidance | **Qwen2.5-VL** via OpenRouter | Claude claude-sonnet-4-20250514 |
| Voice transcription | **Whisper** (local, `whisper.cpp`) | AssemblyAI |
| Text-to-speech | **Kokoro TTS** (local, free) | ElevenLabs |
| Embeddings / search | **nomic-embed-text** (Ollama) | OpenAI |

> **Why Qwen2.5-VL?** It is currently one of the strongest open-weight vision models
> for UI understanding. It understands form fields, buttons, error messages, and tables
> in screenshots — exactly what we need for portal navigation. Free tier available on
> OpenRouter (`qwen/qwen2.5-vl-72b-instruct:free`).

> **Model routing logic**: Try free model first. If response confidence is low or
> model errors, auto-retry with Claude fallback. Log all fallbacks so we can tune thresholds.

### Backend (Supabase)
- **Auth**: Supabase Auth (email + magic link)
- **Database**: Postgres via Supabase
- **Storage**: Supabase Storage (for session screenshots if needed)
- **Realtime**: Supabase Realtime (live admin dashboard updates)
- **Edge Functions**: For AI proxy (keeps API keys off the desktop client)

### Web Dashboard (Next.js)
- **Framework**: Next.js 14 App Router
- **Hosting**: Vercel
- **Styling**: Tailwind CSS + shadcn/ui
- **Charts**: Recharts (usage analytics)

---

## Repository Structure

```
mwongozo/
├── CLAUDE.md                  ← You are here. Read before anything else.
├── desktop/                   ← Electron app (main deliverable)
│   ├── src/
│   │   ├── main/              ← Electron main process
│   │   │   ├── index.ts       ← App entry, window creation, tray
│   │   │   ├── companion.ts   ← Central state machine (replaces CompanionManager.swift)
│   │   │   ├── screenshot.ts  ← Screen capture via desktopCapturer
│   │   │   ├── hotkey.ts      ← Global push-to-talk hotkey
│   │   │   ├── audio.ts       ← Mic capture, audio pipeline
│   │   │   ├── tray.ts        ← System tray icon + menu
│   │   │   ├── overlay.ts     ← Transparent overlay window management
│   │   │   └── config.ts      ← Org code loading, Supabase profile fetch
│   │   ├── services/
│   │   │   ├── vision.ts      ← Qwen2.5-VL / Claude vision API (via proxy)
│   │   │   ├── transcription/ ← Whisper (local) + AssemblyAI fallback
│   │   │   ├── tts/           ← Kokoro (local) + ElevenLabs fallback
│   │   │   └── flows.ts       ← Pre-mapped portal flow loader
│   │   ├── renderer/
│   │   │   ├── panel/         ← System tray panel UI (React)
│   │   │   ├── overlay/       ← Screen overlay UI (cursor, text bubble)
│   │   │   └── onboarding/    ← Org code entry screen
│   │   └── shared/
│   │       ├── types.ts       ← Shared TypeScript interfaces
│   │       └── ipc.ts         ← IPC channel definitions
│   ├── flows/                 ← Pre-mapped portal step definitions (JSON)
│   │   ├── tra-vat-filing.json
│   │   ├── tra-paye.json
│   │   ├── brela-registration.json
│   │   ├── zssf-contribution.json
│   │   └── nhif-registration.json
│   └── package.json
├── proxy/                     ← API proxy (Cloudflare Worker or Node server)
│   └── src/index.ts           ← Routes: /vision, /tts, /transcribe-token
├── dashboard/                 ← Next.js web admin dashboard
│   ├── app/
│   │   ├── (auth)/            ← Login, signup
│   │   ├── dashboard/         ← Admin overview
│   │   ├── org/               ← Org settings, code generation
│   │   ├── clients/           ← Client company management
│   │   ├── analytics/         ← Usage tracking, flow completion rates
│   │   └── flows/             ← Custom flow builder (Phase 2)
│   └── package.json
└── supabase/
    ├── migrations/            ← DB schema migrations
    └── seed.sql               ← Dev seed data
```

---

## Database Schema

```sql
-- Organizations (firms: accounting firms, law firms, etc.)
CREATE TABLE orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,          -- e.g. "kpmg-tz"
  country TEXT DEFAULT 'TZ',
  language TEXT DEFAULT 'sw',         -- sw = Swahili, en = English
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Org codes (what staff type into the desktop app)
CREATE TABLE org_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES orgs(id),
  code TEXT UNIQUE NOT NULL,          -- e.g. "KPMG-TZ-4829"
  code_type TEXT NOT NULL,            -- 'staff' | 'client'
  label TEXT,                         -- e.g. "Finance Team" or "Zanzibar Freight Ltd"
  client_org_id UUID REFERENCES orgs(id), -- set if code_type = 'client'
  flow_access TEXT[] DEFAULT '{}',    -- which flow IDs this code unlocks
  max_activations INT,                -- null = unlimited
  activations INT DEFAULT 0,
  is_active BOOL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users (individual humans — staff or client staff)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  org_id UUID REFERENCES orgs(id),
  name TEXT,
  email TEXT,
  role TEXT DEFAULT 'member',         -- 'admin' | 'member'
  language_pref TEXT DEFAULT 'sw',
  onboarding_code TEXT,               -- the code they used to activate
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sessions (each guidance interaction)
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  org_id UUID REFERENCES orgs(id),
  flow_id TEXT,                       -- e.g. "tra-vat-filing"
  flow_step INT,                      -- which step they were on
  state TEXT,                         -- 'completed' | 'abandoned' | 'error'
  duration_seconds INT,
  transcript TEXT,                    -- what the user said
  ai_response TEXT,                   -- what the AI said
  screenshot_taken BOOL DEFAULT FALSE,
  model_used TEXT,                    -- which AI model responded
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Flow completions (aggregate tracking)
CREATE TABLE flow_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  org_id UUID REFERENCES orgs(id),
  flow_id TEXT NOT NULL,
  completed_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## AI Model Routing Logic

This is the core cost-saving mechanism. Implement in `desktop/src/services/vision.ts`:

```typescript
async function getGuidance(screenshot: Buffer, userQuery: string, context: FlowContext) {
  // 1. Try free model first
  try {
    const result = await callQwenVision(screenshot, userQuery, context);
    if (result.confidence > 0.7) {
      logModelUsed('qwen2.5-vl', result);
      return result;
    }
  } catch (err) {
    logModelFallback('qwen2.5-vl', err);
  }

  // 2. Fall back to Claude if Qwen fails or is low confidence
  const result = await callClaudeVision(screenshot, userQuery, context);
  logModelUsed('claude-sonnet', result);
  return result;
}
```

The proxy (`proxy/src/index.ts`) handles both routes:
- `POST /vision/qwen` → OpenRouter `qwen/qwen2.5-vl-72b-instruct:free`
- `POST /vision/claude` → Anthropic `claude-sonnet-4-20250514`

API keys live ONLY on the proxy — never in the desktop app binary.

---

## Pre-Mapped Flows (flows/*.json)

Flows are step-by-step guides for specific portals. The AI uses these as context —
it knows what step the user should be on before looking at the screenshot.

```json
{
  "id": "tra-vat-filing",
  "name": "TRA VAT Filing",
  "name_sw": "Kujaza Fomu ya VAT - TRA",
  "portal": "https://uas.tra.go.tz",
  "steps": [
    {
      "step": 1,
      "title": "Login to TRA IDARS",
      "title_sw": "Ingia kwenye TRA IDARS",
      "instruction": "Go to uas.tra.go.tz and enter your TIN and password",
      "instruction_sw": "Nenda kwenye uas.tra.go.tz na weka nambari yako ya TIN na nenosiri",
      "expected_screen": "TRA login page with TIN and password fields",
      "success_indicator": "Dashboard visible after login"
    }
  ]
}
```

---

## Org Code Onboarding Flow

When a user opens the app for the first time:

1. They see the onboarding screen — single input for org code
2. App calls `POST /proxy/activate-code` with the code
3. Proxy calls Supabase: validates code, gets org config, increments activations
4. Returns: org name, logo, flow list, language preference
5. App stores profile locally (encrypted), never asks again
6. All sessions tagged with that org_id going forward

```typescript
// desktop/src/main/config.ts
interface OrgProfile {
  orgId: string;
  orgName: string;
  logoUrl: string;
  flowAccess: string[];       // which flows are unlocked
  language: 'sw' | 'en';
  customInstructions: string; // org-specific AI context
  analyticsEnabled: boolean;
}
```

---

## Overlay & Cursor Pointing

Clicky uses `[POINT:x,y:label:screenN]` tags embedded in AI responses.
We keep the same format. The AI is instructed to embed these when it can identify
a target element.

```
Example AI response:
"Bonyeza kitufe cha 'Submit Return' [POINT:1240:680:Submit Return:screen0]
ili kutuma fomu yako ya VAT."
```

The overlay window parses these tags, removes them from displayed text,
and animates the cursor to the coordinates.

In Electron, the overlay is a `BrowserWindow` with:
```javascript
{
  transparent: true,
  frame: false,
  alwaysOnTop: true,
  focusable: false,         // never steals focus
  skipTaskbar: true,
  webPreferences: { nodeIntegration: false }
}
```

---

## Clicky Source → Mwongozo Mapping

When you clone Clicky, here is what maps to what:

| Clicky (Swift/macOS) | Mwongozo (Electron/Cross-platform) |
|---|---|
| `CompanionManager.swift` | `desktop/src/main/companion.ts` |
| `CompanionPanelView.swift` | `desktop/src/renderer/panel/` |
| `OverlayWindow.swift` | `desktop/src/main/overlay.ts` + `renderer/overlay/` |
| `CompanionScreenCaptureUtility.swift` | `desktop/src/main/screenshot.ts` |
| `BuddyDictationManager.swift` | `desktop/src/main/audio.ts` |
| `AssemblyAIStreamingTranscriptionProvider.swift` | `desktop/src/services/transcription/whisper.ts` |
| `ClaudeAPI.swift` | `desktop/src/services/vision.ts` |
| `ElevenLabsTTSClient.swift` | `desktop/src/services/tts/kokoro.ts` |
| `GlobalPushToTalkShortcutMonitor.swift` | `desktop/src/main/hotkey.ts` |
| `worker/src/index.ts` | `proxy/src/index.ts` |
| `DesignSystem.swift` | `desktop/src/renderer/styles/design-tokens.ts` |
| `ClickyAnalytics.swift` | `desktop/src/main/analytics.ts` (PostHog or Supabase) |
| *(new)* | `desktop/src/main/config.ts` — org code + profile |
| *(new)* | `desktop/src/services/flows.ts` — pre-mapped flow loader |
| *(new)* | `dashboard/` — full admin web app |
| *(new)* | `supabase/` — multi-tenant backend |

---

## Build Phases

### Phase 1 — POC (2 weeks) 🎯 BUILD THIS FIRST
**Goal**: One working flow, one fake org code, demo-able to a real accounting firm.

- [ ] Clone Clicky repo
- [ ] Scaffold Electron app (`desktop/`)
- [ ] Screen capture working on Windows (`screenshot.ts`)
- [ ] Transparent overlay window with cursor animation (`overlay.ts`)
- [ ] Global push-to-talk hotkey (`hotkey.ts`)
- [ ] Whisper local transcription (`services/transcription/whisper.ts`)
- [ ] Kokoro TTS local playback (`services/tts/kokoro.ts`)
- [ ] Qwen2.5-VL vision call via OpenRouter proxy (`services/vision.ts`)
- [ ] Load one flow: `tra-vat-filing.json`
- [ ] Hardcoded org code "DEMO-TZ-0001" loads demo config
- [ ] Basic tray panel UI in React (dark theme, Swahili labels)
- [ ] Proxy deployed on Cloudflare Worker

**Success criteria**: A user can open the app on Windows, press Ctrl+Shift (push-to-talk),
ask "Ninafanyaje VAT return?" and the AI shows them the steps with cursor pointing.

---

### Phase 2 — Multi-Tenant Core (4 weeks)
**Goal**: Real companies can sign up, generate codes, track their staff.

- [ ] Supabase schema (all tables above)
- [ ] Next.js dashboard — auth, org creation, code generation
- [ ] Org code activation flow in desktop app
- [ ] Session logging to Supabase
- [ ] Admin analytics: sessions per user, flow completion rates, stuck points
- [ ] 5 pre-mapped flows (TRA VAT, TRA PAYE, BRELA reg, ZSSF, NHIF)
- [ ] Both Swahili and English modes
- [ ] Client code generation (firm → client company)

---

### Phase 3 — Polish & Growth (ongoing)
**Goal**: Product-market fit, first 5 paying customers.

- [ ] Claude fallback routing (when Qwen confidence is low)
- [ ] Custom flow builder in dashboard (drag-and-drop step editor)
- [ ] Universal client profile (multi-code merging)
- [ ] Mobile dashboard (React Native — manager analytics only)
- [ ] Billing integration (Stripe or local payment gateway)
- [ ] Auto-update mechanism for desktop app
- [ ] Offline flow mode (no internet needed for pre-mapped steps)

---

## Proxy API Routes

Deploy on Cloudflare Worker. All API keys stored as Worker secrets.

```typescript
// proxy/src/index.ts

// POST /vision/qwen    → OpenRouter Qwen2.5-VL (primary, cheap)
// POST /vision/claude  → Anthropic Claude (fallback, accurate)
// POST /tts            → Kokoro TTS endpoint or ElevenLabs
// POST /transcribe     → Whisper endpoint or AssemblyAI token
// POST /activate-code  → Validate org code, return org profile (calls Supabase)
// POST /session/log    → Log session to Supabase analytics
```

Worker secrets:
```
OPENROUTER_API_KEY
ANTHROPIC_API_KEY
ELEVENLABS_API_KEY        (fallback only)
ASSEMBLYAI_API_KEY        (fallback only)
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

---

## AI System Prompt (Vision Guidance)

This is the core prompt sent with every screenshot. Inject the current flow context.

```
You are Mwongozo, an AI navigation guide helping users navigate Tanzanian government
portals and business software. You are knowledgeable about TRA IDARS, BRELA, ZSSF,
NHIF, and common business software used in Tanzania.

LANGUAGE: Respond in {{language}}. If Swahili, use clear, simple Swahili appropriate
for a professional office environment.

CURRENT FLOW: {{flow_name}}
CURRENT STEP: {{step_number}} of {{total_steps}}
STEP INSTRUCTION: {{step_instruction}}

RULES:
1. Look at the screenshot carefully. Identify the current state of the screen.
2. Give ONE clear, concise instruction for what to do next.
3. If you can see the exact element to click, embed a POINT tag: [POINT:x:y:label:screen0]
4. Do not overwhelm the user. One action at a time.
5. If the user seems stuck or there is an error on screen, acknowledge it and help them fix it.
6. Keep responses under 3 sentences.
7. If the screen matches the expected state for the next step, advance automatically.

RESPONSE FORMAT:
- Text instruction (in chosen language)
- Optional: [POINT:x:y:label:screen0] at the END if pointing is needed
```

---

## Design System

Dark theme, professional but warm. Swahili-first but bilingual.

```typescript
// desktop/src/renderer/styles/design-tokens.ts
export const DS = {
  colors: {
    bg: '#0a0e17',
    surface: '#111827',
    surface2: '#1f2937',
    border: 'rgba(255,255,255,0.08)',
    accent: '#10b981',        // Green — East African flag colors reference
    accentBlue: '#3b82f6',
    text: '#f9fafb',
    textMuted: '#9ca3af',
    cursor: '#10b981',        // Overlay cursor color (green, not blue like Clicky)
    danger: '#ef4444',
  },
  font: {
    ui: 'DM Sans',            // Clean, works in both English and Swahili
    mono: 'JetBrains Mono',
  },
  radius: {
    sm: '6px',
    md: '10px',
    lg: '16px',
    pill: '999px',
  }
}
```

---

## Code Style & Conventions

### TypeScript
- All files in TypeScript, strict mode enabled
- Interfaces over types for objects
- Async/await throughout — no raw Promise chains
- IPC channels defined in `shared/ipc.ts` — never hard-code channel names

### Naming
- Be verbose and descriptive — `currentOrgProfileFromSupabase` not `profile`
- IPC channels: `VERB:NOUN` format — `SCREENSHOT:CAPTURE`, `FLOW:LOAD`, `SESSION:LOG`
- React components: PascalCase, files match component name

### Comments
- Explain WHY, not WHAT
- Every non-obvious piece of Electron IPC bridging needs a comment
- Every model routing decision (why we fell back to Claude) must be logged

### Do NOT
- Do not store API keys anywhere in the desktop app — proxy only
- Do not call AI APIs directly from the renderer process — main process only
- Do not take screenshots silently without user awareness (show indicator in tray)
- Do not send screenshots to any server without the org's analytics_enabled flag set
- Do not rename the Clicky source files you don't need to change — reference them as-is

---

## Environment Variables

### Proxy (Cloudflare Worker secrets)
```
OPENROUTER_API_KEY=sk-or-...
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ELEVENLABS_API_KEY=...           # fallback
ASSEMBLYAI_API_KEY=...           # fallback
```

### Desktop (stored in app config, loaded from proxy — not env vars)
```
PROXY_URL=https://mwongozo-proxy.your-subdomain.workers.dev
```

### Dashboard (Vercel env)
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```
