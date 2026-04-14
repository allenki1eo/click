/**
 * Mwongozo Proxy — Cloudflare Worker
 *
 * Routes:
 * POST /chat       → AI model (OpenRouter OR BigModel.cn)
 * POST /tts        → ElevenLabs text-to-speech
 * POST /transcribe → Voice transcription (Groq Whisper preferred, AssemblyAI fallback)
 * POST /detect     → Claude Computer Use API for UI element coordinates
 *
 * Environment Variables:
 * - OPENROUTER_API_KEY:  For OpenRouter models
 * - BIGMODEL_API_KEY:    For GLM-5V-Turbo on BigModel.cn
 * - ELEVENLABS_API_KEY:  For text-to-speech
 * - ELEVENLABS_VOICE_ID: Default voice ID
 * - GROQ_API_KEY:        Preferred transcription (Whisper via Groq, ~1s)
 * - ASSEMBLYAI_API_KEY:  Fallback transcription (upload+poll, ~10s)
 * - ANTHROPIC_API_KEY:   Computer Use API for accurate coordinate detection
 */

interface Env {
  // AI Providers (at least one required)
  OPENROUTER_API_KEY?: string
  BIGMODEL_API_KEY?: string
  // TTS
  ELEVENLABS_API_KEY: string
  ELEVENLABS_VOICE_ID: string
  // Transcription — Groq is preferred (fast, ~1s); AssemblyAI is fallback (~10s)
  GROQ_API_KEY?:      string
  ASSEMBLYAI_API_KEY?: string
  // Computer Use element detection (optional — falls back to POINT tag parsing)
  ANTHROPIC_API_KEY?: string
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function ok(body: BodyInit | null, init: ResponseInit = {}): Response {
  return new Response(body, { ...init, headers: { ...CORS, ...(init.headers ?? {}) } })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return ok(null, { status: 204 })
    if (request.method !== 'POST') return ok('Method not allowed', { status: 405 })

    const { pathname } = new URL(request.url)

    try {
      if (pathname === '/chat')      return await handleChat(request, env)
      if (pathname === '/tts')       return await handleTts(request, env)
      if (pathname === '/transcribe') return await handleTranscribe(request, env)
      if (pathname === '/detect')    return await handleDetect(request, env)
      return ok('Not found', { status: 404 })
    } catch (err) {
      console.error(`[${pathname}]`, err)
      return ok(JSON.stringify({ error: String(err) }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    }
  },
}

// ---------------------------------------------------------------------------
// /chat — Supports multiple AI providers
// ---------------------------------------------------------------------------

async function handleChat(request: Request, env: Env): Promise<Response> {
  const body = await request.text()
  const parsed = JSON.parse(body)
  const model = parsed.model || ''

  // Route to appropriate provider based on model
  if (model.includes('glm') || model.includes('bigmodel')) {
    // BigModel.cn (Zhipu AI) - GLM series
    return await handleBigModelChat(body, env)
  } else {
    // OpenRouter - default
    return await handleOpenRouterChat(body, env)
  }
}

async function handleOpenRouterChat(body: string, env: Env): Promise<Response> {
  if (!env.OPENROUTER_API_KEY) {
    return ok(JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
      'content-type': 'application/json',
      'HTTP-Referer': 'https://github.com/allenki1eo/click',
      'X-Title': 'Mwongozo',
    },
    body,
  })

  if (!upstream.ok) {
    const err = await upstream.text()
    console.error('[OpenRouter] upstream error', upstream.status, err)
    return ok(err, { status: upstream.status, headers: { 'content-type': 'application/json' } })
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...CORS,
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    },
  })
}

async function handleBigModelChat(body: string, env: Env): Promise<Response> {
  if (!env.BIGMODEL_API_KEY) {
    return ok(JSON.stringify({ error: 'BIGMODEL_API_KEY not configured' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  const parsed = JSON.parse(body)

  // BigModel.cn uses OpenAI-compatible format but different endpoint
  const upstream = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.BIGMODEL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: parsed.model || 'glm-5v-turbo',
      messages: parsed.messages,
      stream: true,
      max_tokens: parsed.max_tokens ?? 800,
    }),
  })

  if (!upstream.ok) {
    const err = await upstream.text()
    console.error('[BigModel] upstream error', upstream.status, err)
    return ok(err, { status: upstream.status, headers: { 'content-type': 'application/json' } })
  }

  // Pipe the streaming SSE response directly to the client
  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...CORS,
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    },
  })
}

// ---------------------------------------------------------------------------
// /tts — ElevenLabs text-to-speech
// ---------------------------------------------------------------------------

async function handleTts(request: Request, env: Env): Promise<Response> {
  const { text, voiceId } = await request.json() as { text: string; voiceId?: string }
  const voice = voiceId ?? env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM'

  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': env.ELEVENLABS_API_KEY,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_flash_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  )

  if (!upstream.ok) {
    const err = await upstream.text()
    console.error('/tts upstream error', upstream.status, err)
    return ok(err, { status: upstream.status })
  }

  return new Response(upstream.body, {
    status: 200,
    headers: { ...CORS, 'content-type': 'audio/mpeg' },
  })
}

// ---------------------------------------------------------------------------
// /transcribe — Voice-to-text pipeline
//
// Provider priority:
//   1. Groq Whisper   (GROQ_API_KEY)    — ~1s, multipart/form-data
//   2. AssemblyAI     (ASSEMBLYAI_API_KEY) — ~10s, upload → poll
//
// Client POSTs raw audio bytes (audio/webm;codecs=opus from MediaRecorder).
// Returns JSON { text: string }.
// ---------------------------------------------------------------------------

async function handleTranscribe(request: Request, env: Env): Promise<Response> {
  const audioBuffer = await request.arrayBuffer()
  if (!audioBuffer.byteLength) {
    return ok(JSON.stringify({ error: 'No audio data received', text: '' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }
  console.info(`[transcribe] Received ${audioBuffer.byteLength} bytes`)

  // ── Groq Whisper (preferred — fast, ~1s) ──────────────────────────────────
  if (env.GROQ_API_KEY) {
    try {
      const text = await transcribeWithGroq(audioBuffer, env.GROQ_API_KEY)
      console.info('[transcribe] Groq completed:', text || '(empty)')
      return ok(JSON.stringify({ text }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    } catch (err) {
      console.error('[transcribe] Groq failed, falling back to AssemblyAI:', String(err))
    }
  }

  // ── AssemblyAI fallback (upload → submit → poll, ~10s) ───────────────────
  if (!env.ASSEMBLYAI_API_KEY) {
    return ok(JSON.stringify({
      error: 'No transcription provider configured. Add GROQ_API_KEY (recommended) or ASSEMBLYAI_API_KEY to .dev.vars',
      text: '',
    }), { status: 500, headers: { 'content-type': 'application/json' } })
  }

  const auth = env.ASSEMBLYAI_API_KEY

  // Step 1: Upload audio
  const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/octet-stream' },
    body: audioBuffer,
  })
  if (!uploadRes.ok) {
    const err = await uploadRes.text()
    console.error('[transcribe] AssemblyAI upload failed:', uploadRes.status, err)
    return ok(JSON.stringify({ error: `AssemblyAI upload failed (${uploadRes.status}): ${err}`, text: '' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
  const { upload_url } = await uploadRes.json() as { upload_url: string }
  console.info('[transcribe] AssemblyAI audio uploaded')

  // Step 2: Submit transcription job
  const txRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify({ audio_url: upload_url }),
  })
  if (!txRes.ok) {
    const err = await txRes.text()
    console.error('[transcribe] AssemblyAI submit failed:', txRes.status, err)
    return ok(JSON.stringify({ error: `AssemblyAI submit failed (${txRes.status}): ${err}`, text: '' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
  const { id } = await txRes.json() as { id: string }
  console.info('[transcribe] AssemblyAI job submitted, ID:', id)

  // Step 3: Poll until completed (max 20 × 1.5s = 30s)
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1500))
    const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { authorization: auth },
    })
    const data = await poll.json() as { status: string; text?: string; error?: string }
    console.info(`[transcribe] AssemblyAI status: ${data.status} (${i + 1}/20)`)
    if (data.status === 'completed') {
      const text = data.text?.trim() ?? ''
      console.info('[transcribe] AssemblyAI completed:', text || '(empty)')
      return ok(JSON.stringify({ text }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (data.status === 'error') {
      console.error('[transcribe] AssemblyAI error:', data.error)
      return ok(JSON.stringify({ error: `AssemblyAI: ${data.error}`, text: '' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    }
  }

  return ok(JSON.stringify({ error: 'Transcription timed out after 30s', text: '' }), {
    status: 500,
    headers: { 'content-type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Groq Whisper transcription — fast (~1s), supports audio/webm natively
// API: https://console.groq.com/docs/speech-text
// ---------------------------------------------------------------------------

async function transcribeWithGroq(audioBuffer: ArrayBuffer, apiKey: string): Promise<string> {
  // Groq uses the OpenAI-compatible audio transcription endpoint
  // It requires multipart/form-data with the audio as a file field
  const formData = new FormData()
  const audioBlob = new Blob([audioBuffer], { type: 'audio/webm' })
  formData.append('file', audioBlob, 'recording.webm')
  formData.append('model', 'whisper-large-v3-turbo')  // fastest Groq Whisper model
  formData.append('response_format', 'json')

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    // Do NOT set Content-Type — fetch sets it automatically with the correct boundary
    body: formData,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Groq ${res.status}: ${err}`)
  }

  const data = await res.json() as { text?: string }
  return data.text?.trim() ?? ''
}

// ---------------------------------------------------------------------------
// /detect — Claude Computer Use API for accurate UI element coordinates
//
// Client sends a screenshot pre-resized to the chosen Computer Use resolution.
// We call the Anthropic Computer Use beta; Claude returns a click coordinate
// in CU-resolution space which we scale back to display-local logical pixels.
//
// Falls back gracefully (returns {x:null,y:null}) when ANTHROPIC_API_KEY is
// not configured so the client can fall back to POINT-tag parsing.
// ---------------------------------------------------------------------------

/** Anthropic-recommended Computer Use resolutions, mapped to aspect ratio. */
const CU_RESOLUTIONS = [
  { w: 1024, h: 768  },   // 4:3   – legacy
  { w: 1280, h: 800  },   // 16:10 – most MacBooks
  { w: 1366, h: 768  },   // ~16:9 – external monitors
]

function bestCuResolution(displayW: number, displayH: number): { w: number; h: number } {
  const ratio = displayW / Math.max(1, displayH)
  return CU_RESOLUTIONS.reduce((best, r) =>
    Math.abs(r.w / r.h - ratio) < Math.abs(best.w / best.h - ratio) ? r : best
  )
}

async function handleDetect(request: Request, env: Env): Promise<Response> {
  // Graceful no-op when key not configured — client falls back to POINT tag
  if (!env.ANTHROPIC_API_KEY) {
    return ok(JSON.stringify({ x: null, y: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const body = await request.json() as {
    screenshotBase64: string   // already resized to cuWidth × cuHeight by client
    userQuestion:     string
    displayWidth:     number   // display logical px (for scaling CU coords back)
    displayHeight:    number
    cuWidth:          number   // dimensions the screenshot was resized to
    cuHeight:         number
  }

  const { screenshotBase64, userQuestion, displayWidth, displayHeight, cuWidth, cuHeight } = body

  const prompt =
    `The user asked: "${userQuestion}"\n\n` +
    `Look at the screenshot. If there is a specific UI element (button, link, menu item, ` +
    `text field, icon, etc.) the user should interact with or is asking about, click on it. ` +
    `If the question is purely conceptual and there is no specific element to point to, ` +
    `respond with plain text saying "no element".`

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':          env.ANTHROPIC_API_KEY,
      'anthropic-version':  '2023-06-01',
      'anthropic-beta':     'computer-use-2025-11-24',
      'content-type':       'application/json',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 256,
      tools: [{
        type:               'computer_20251124',
        name:               'computer',
        display_width_px:   cuWidth,
        display_height_px:  cuHeight,
      }],
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshotBase64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  })

  if (!upstream.ok) {
    const err = await upstream.text()
    console.error('[detect] Anthropic error', upstream.status, err.slice(0, 200))
    return ok(JSON.stringify({ x: null, y: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const data = await upstream.json() as { content?: Array<{ type: string; input?: { coordinate?: number[] } }> }

  for (const block of data.content ?? []) {
    if (block.type === 'tool_use' && Array.isArray(block.input?.coordinate) && block.input.coordinate.length === 2) {
      const [cuX, cuY] = block.input.coordinate
      // Clamp to declared resolution
      const cx = Math.max(0, Math.min(cuX, cuWidth))
      const cy = Math.max(0, Math.min(cuY, cuHeight))
      // Scale from CU resolution → display logical pixels
      const scaledX = Math.round((cx / cuWidth)  * displayWidth)
      const scaledY = Math.round((cy / cuHeight) * displayHeight)
      console.info(`[detect] CU (${cx},${cy}) in ${cuWidth}×${cuHeight} → (${scaledX},${scaledY}) in ${displayWidth}×${displayHeight}`)
      return ok(JSON.stringify({ x: scaledX, y: scaledY }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
  }

  // Claude responded with text — no specific element found
  return ok(JSON.stringify({ x: null, y: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
