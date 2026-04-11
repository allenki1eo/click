/**
 * Mwongozo Proxy — Cloudflare Worker
 *
 * Extended from clicky's worker/src/index.ts.
 *
 * ALL API keys live here as Cloudflare secrets. The desktop app
 * binary never contains any keys — it only knows the proxy URL.
 *
 * Routes:
 *   POST /vision/qwen     → OpenRouter Qwen2.5-VL (primary, free)
 *   POST /vision/claude   → Anthropic Claude Sonnet (fallback, accurate)
 *   POST /tts             → edge-tts (primary, free) or Piper TTS (secondary)
 *   POST /transcribe      → Whisper transcription
 *   POST /transcribe-token → AssemblyAI short-lived token (legacy fallback)
 *   POST /activate-code   → Validate org code via Supabase, return OrgProfile
 *   POST /session/log     → Log session analytics to Supabase
 *
 * TTS provider chain (no API key required for any of these):
 *   1. edge-tts  — Microsoft Edge neural TTS via WebSocket (free, sw-TZ-DaudiNeural)
 *   2. Piper TTS — Open-source self-hosted server (set PIPER_TTS_URL secret)
 *   ElevenLabs removed — API keys are unreliable and expensive.
 */

interface Env {
  // Vision
  OPENROUTER_API_KEY: string
  ANTHROPIC_API_KEY: string

  // TTS — no keys needed for edge-tts or Piper, but Piper needs a server URL
  /** URL of your self-hosted Piper TTS HTTP server, e.g. https://piper.example.com */
  PIPER_TTS_URL: string

  // Transcription
  ASSEMBLYAI_API_KEY: string

  // Supabase
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string

  // Config
  APP_VERSION_MIN: string
}

// ---------------------------------------------------------------------------
// CORS headers — Electron apps don't send an Origin header,
// so we allow null origin (Electron main process fetch)
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Language, X-App-Version'
}

function corsResponse(body: string | ReadableStream | null, init: ResponseInit = {}): Response {
  return new Response(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init.headers ?? {}) }
  })
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(null, { status: 204 })
    }

    if (request.method !== 'POST') {
      return corsResponse('Method not allowed', { status: 405 })
    }

    try {
      switch (url.pathname) {
        case '/vision/qwen':
          return await handleQwenVision(request, env)
        case '/vision/claude':
          return await handleClaudeVision(request, env)
        case '/tts':
          return await handleTts(request, env)
        case '/transcribe':
          return await handleTranscribe(request, env)
        case '/transcribe-token':
          return await handleTranscribeToken(env)
        case '/activate-code':
          return await handleActivateCode(request, env)
        case '/session/log':
          return await handleSessionLog(request, env)
        default:
          return corsResponse('Not found', { status: 404 })
      }
    } catch (error) {
      console.error(`[${url.pathname}] Unhandled error:`, error)
      return corsResponse(
        JSON.stringify({ error: String(error) }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Vision: Qwen2.5-VL via OpenRouter (primary — free tier)
// ---------------------------------------------------------------------------

async function handleQwenVision(request: Request, env: Env): Promise<Response> {
  const body = await request.text()

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://mwongozo.app',
      'X-Title': 'Mwongozo'
    },
    body
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error(`[/vision/qwen] OpenRouter error ${response.status}: ${errorBody}`)
    return corsResponse(errorBody, {
      status: response.status,
      headers: { 'content-type': 'application/json' }
    })
  }

  return corsResponse(response.body, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' }
  })
}

// ---------------------------------------------------------------------------
// Vision: Claude Sonnet via Anthropic (fallback — accurate)
// ---------------------------------------------------------------------------

async function handleClaudeVision(request: Request, env: Env): Promise<Response> {
  const body = await request.text()

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error(`[/vision/claude] Anthropic error ${response.status}: ${errorBody}`)
    return corsResponse(errorBody, {
      status: response.status,
      headers: { 'content-type': 'application/json' }
    })
  }

  return corsResponse(response.body, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' }
  })
}

// ---------------------------------------------------------------------------
// TTS: edge-tts (primary, free) → Piper TTS (secondary, self-hosted)
// ElevenLabs removed — API keys are unreliable, and these options are free.
// ---------------------------------------------------------------------------

async function handleTts(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as {
    provider?: 'edge' | 'piper'
    text: string
    voice?: string
    language?: string
  }

  // Default to edge-tts (requires no secret at all)
  const provider = body.provider ?? 'edge'

  if (provider === 'edge') {
    return await handleEdgeTts(body.text, body.voice ?? 'sw-TZ-DaudiNeural')
  }

  if (provider === 'piper') {
    return await handlePiperTts(body.text, body.voice ?? 'sw_CD-akashic-medium', env)
  }

  return corsResponse('Unknown TTS provider', { status: 400 })
}

// ---------------------------------------------------------------------------
// edge-tts: Microsoft Edge neural TTS via WebSocket
//
// Uses the same endpoint as the Microsoft Edge browser's read-aloud feature.
// No API key required — it's a public endpoint with a static trusted token.
//
// Voices with Swahili support:
//   sw-TZ-DaudiNeural   — Tanzanian Swahili, male   ✅ recommended
//   sw-KE-ZuriNeural    — Kenyan Swahili, female
//   sw-TZ-RehemaNeural  — Tanzanian Swahili, female
//
// Reference: https://github.com/rany2/edge-tts (MIT License)
// ---------------------------------------------------------------------------

const EDGE_TTS_TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const EDGE_TTS_WS_BASE = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'

function generateUuid(): string {
  // Simple UUID v4 without crypto dependency
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function buildSsml(text: string, voice: string): string {
  // Derive lang from voice name, e.g. sw-TZ-DaudiNeural → sw-TZ
  const lang = voice.split('-').slice(0, 2).join('-')
  // Escape XML special chars
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
    `<voice name='${voice}'>${escaped}</voice></speak>`
  )
}

async function handleEdgeTts(text: string, voice: string): Promise<Response> {
  const connectionId = generateUuid().replace(/-/g, '')
  const wsUrl = `${EDGE_TTS_WS_BASE}?TrustedClientToken=${EDGE_TTS_TRUSTED_TOKEN}&ConnectionId=${connectionId}`

  return new Promise<Response>((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const audioChunks: Uint8Array[] = []

    ws.addEventListener('open', () => {
      const timestamp = new Date().toISOString()

      // Message 1: audio format config
      ws.send(
        `X-Timestamp:${timestamp}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'true' },
                // 24kHz 48kbps mono MP3 — good quality, small file size
                outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
              }
            }
          }
        })
      )

      // Message 2: SSML with the text to speak
      const requestId = generateUuid().replace(/-/g, '')
      ws.send(
        `X-RequestId:${requestId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${timestamp}\r\n` +
        `Path:ssml\r\n\r\n` +
        buildSsml(text, voice)
      )
    })

    ws.addEventListener('message', (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        // Binary frame: [uint16 header-length][text header][MP3 audio data]
        const view = new DataView(event.data)
        const headerLen = view.getUint16(0)          // first 2 bytes = header length
        const headerText = new TextDecoder().decode(
          new Uint8Array(event.data, 2, headerLen)
        )

        if (headerText.includes('Path:audio')) {
          // Everything after the header is MP3 audio
          const audioData = new Uint8Array(event.data, 2 + headerLen)
          if (audioData.byteLength > 0) {
            audioChunks.push(audioData)
          }
        }
      } else if (typeof event.data === 'string') {
        if (event.data.includes('Path:turn.end')) {
          // Synthesis complete — assemble all chunks and return
          ws.close()

          if (audioChunks.length === 0) {
            reject(new Error('edge-tts: no audio chunks received'))
            return
          }

          const totalBytes = audioChunks.reduce((n, c) => n + c.byteLength, 0)
          const combined = new Uint8Array(totalBytes)
          let offset = 0
          for (const chunk of audioChunks) {
            combined.set(chunk, offset)
            offset += chunk.byteLength
          }

          resolve(corsResponse(combined.buffer, {
            status: 200,
            headers: { 'content-type': 'audio/mpeg' }
          }))
        }
      }
    })

    ws.addEventListener('error', (err: Event) => {
      reject(new Error(`edge-tts WebSocket error: ${String(err)}`))
    })

    ws.addEventListener('close', (event: CloseEvent) => {
      if (!event.wasClean && audioChunks.length === 0) {
        reject(new Error(`edge-tts WebSocket closed unexpectedly (code ${event.code})`))
      }
    })

    // Safety timeout — edge-tts should respond in <10s for short text
    setTimeout(() => {
      if (ws.readyState !== WebSocket.CLOSED) ws.close()
      if (audioChunks.length === 0) {
        reject(new Error('edge-tts timed out'))
      }
    }, 12_000)
  })
}

// ---------------------------------------------------------------------------
// Piper TTS: open-source, self-hostable
//
// Deploy Piper as an HTTP server:
//   docker run -it -p 5000:5000 rhasspy/piper --voice sw_CD-akashic-medium
// Set PIPER_TTS_URL secret to e.g. https://your-piper-server.railway.app
//
// Piper Swahili model: sw_CD-akashic-medium (DRC Swahili, close to Tanzanian)
// Download: https://huggingface.co/rhasspy/piper-voices/tree/main/sw/sw_CD
// ---------------------------------------------------------------------------

async function handlePiperTts(text: string, voice: string, env: Env): Promise<Response> {
  if (!env.PIPER_TTS_URL) {
    throw new Error('PIPER_TTS_URL secret not configured')
  }

  const response = await fetch(`${env.PIPER_TTS_URL}/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, output_format: 'mp3' })
  })

  if (!response.ok) {
    throw new Error(`Piper TTS error ${response.status}: ${await response.text()}`)
  }

  return corsResponse(response.body, {
    status: 200,
    headers: { 'content-type': 'audio/mpeg' }
  })
}

// ---------------------------------------------------------------------------
// Transcription: Whisper
// ---------------------------------------------------------------------------

async function handleTranscribe(request: Request, env: Env): Promise<Response> {
  const audioBuffer = await request.arrayBuffer()
  const language = request.headers.get('X-Language') ?? 'sw'

  // Use OpenRouter's Whisper endpoint or a self-hosted whisper.cpp API
  // For Phase 1 we use AssemblyAI's REST API as Whisper is not yet self-hosted
  const formData = new FormData()
  formData.append('audio', new Blob([audioBuffer], { type: 'audio/wav' }), 'audio.wav')
  formData.append('language_code', language)

  // AssemblyAI universal transcription (non-streaming, for short clips)
  const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: {
      authorization: env.ASSEMBLYAI_API_KEY,
      'content-type': 'application/octet-stream'
    },
    body: audioBuffer
  })

  if (!uploadResponse.ok) {
    return corsResponse('Upload failed', { status: 500 })
  }

  const { upload_url: audioUrl } = await uploadResponse.json() as { upload_url: string }

  const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      authorization: env.ASSEMBLYAI_API_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ audio_url: audioUrl, language_code: language })
  })

  const { id: transcriptId } = await transcriptResponse.json() as { id: string }

  // Poll for result (max 30s)
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      headers: { authorization: env.ASSEMBLYAI_API_KEY }
    })
    const data = await poll.json() as { status: string; text?: string }

    if (data.status === 'completed') {
      return corsResponse(
        JSON.stringify({ text: data.text ?? '' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
    if (data.status === 'error') {
      return corsResponse(
        JSON.stringify({ text: '' }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      )
    }
  }

  return corsResponse(
    JSON.stringify({ text: '' }),
    { status: 408, headers: { 'content-type': 'application/json' } }
  )
}

// ---------------------------------------------------------------------------
// AssemblyAI streaming token (legacy — from clicky's original worker)
// ---------------------------------------------------------------------------

async function handleTranscribeToken(env: Env): Promise<Response> {
  const response = await fetch(
    'https://streaming.assemblyai.com/v3/token?expires_in_seconds=480',
    { method: 'GET', headers: { authorization: env.ASSEMBLYAI_API_KEY } }
  )

  if (!response.ok) {
    const errorBody = await response.text()
    return corsResponse(errorBody, {
      status: response.status,
      headers: { 'content-type': 'application/json' }
    })
  }

  return corsResponse(await response.text(), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

// ---------------------------------------------------------------------------
// Org code activation — validates against Supabase, returns OrgProfile
// ---------------------------------------------------------------------------

async function handleActivateCode(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { code: string; appVersion?: string }
  const code = body.code?.toUpperCase()

  if (!code) {
    return corsResponse(
      JSON.stringify({ success: false, error: 'Code is required' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    )
  }

  // Query Supabase for the org code
  const supabaseResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/rpc/activate_org_code`,
    {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_code: code })
    }
  )

  if (!supabaseResponse.ok) {
    const errorBody = await supabaseResponse.text()
    console.error('[/activate-code] Supabase error:', errorBody)
    return corsResponse(
      JSON.stringify({ success: false, error: 'Seva imeshindwa. Jaribu tena. / Server error.' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    )
  }

  const data = await supabaseResponse.json() as {
    valid: boolean
    org_id?: string
    org_name?: string
    logo_url?: string
    flow_access?: string[]
    language?: string
    custom_instructions?: string
    analytics_enabled?: boolean
    error?: string
  }

  if (!data.valid) {
    return corsResponse(
      JSON.stringify({
        success: false,
        error: data.error ?? 'Nambari si sahihi. / Invalid code.'
      }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    )
  }

  const profile = {
    orgId: data.org_id!,
    orgName: data.org_name!,
    logoUrl: data.logo_url ?? '',
    flowAccess: data.flow_access ?? [],
    language: (data.language ?? 'sw') as 'sw' | 'en',
    customInstructions: data.custom_instructions ?? '',
    analyticsEnabled: data.analytics_enabled ?? true,
    activationCode: code
  }

  return corsResponse(
    JSON.stringify({ success: true, profile }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

// ---------------------------------------------------------------------------
// Session analytics logging — fire-and-forget write to Supabase
// ---------------------------------------------------------------------------

async function handleSessionLog(request: Request, env: Env): Promise<Response> {
  const event = await request.json()

  // Don't block the client — log async and return immediately
  const logPromise = fetch(`${env.SUPABASE_URL}/rest/v1/sessions`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(event)
  }).catch((err) => {
    console.error('[/session/log] Failed to log session:', err)
  })

  // Use waitUntil so the worker doesn't terminate before the log completes
  // (ctx.waitUntil is available in Worker context — TypeScript type narrowing needed)
  // Note: in practice, use the ExecutionContext parameter for this
  void logPromise

  return corsResponse(
    JSON.stringify({ ok: true }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}
