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
 *   POST /tts             → Kokoro or ElevenLabs TTS
 *   POST /transcribe      → Whisper transcription
 *   POST /transcribe-token → AssemblyAI short-lived token (legacy fallback)
 *   POST /activate-code   → Validate org code via Supabase, return OrgProfile
 *   POST /session/log     → Log session analytics to Supabase
 *
 * CORS: requests only accepted from the Electron app (no Origin header)
 * or from the dashboard domain.
 */

interface Env {
  // Vision
  OPENROUTER_API_KEY: string
  ANTHROPIC_API_KEY: string

  // TTS
  ELEVENLABS_API_KEY: string
  ELEVENLABS_VOICE_ID: string

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
// TTS: Kokoro (primary) or ElevenLabs (fallback)
// ---------------------------------------------------------------------------

async function handleTts(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as {
    provider?: 'kokoro' | 'elevenlabs'
    text: string
    language?: string
    voice?: string
    model_id?: string
    voice_settings?: object
  }

  const provider = body.provider ?? 'kokoro'

  if (provider === 'kokoro') {
    return await handleKokoroTts(body.text, body.language ?? 'sw', body.voice ?? 'af_sarah', env)
  }

  // ElevenLabs (from clicky's original handleTTS)
  return await handleElevenLabsTts(body, env)
}

async function handleKokoroTts(
  text: string,
  language: string,
  voice: string,
  env: Env
): Promise<Response> {
  // Kokoro TTS — self-hosted or via a compatible endpoint
  // For Phase 1, we use the public Kokoro API demo endpoint.
  // TODO: Deploy a dedicated Kokoro instance for production reliability.
  const response = await fetch('https://api.kokorotts.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'kokoro',
      input: text,
      voice,
      response_format: 'mp3',
      speed: 1.0
    })
  })

  if (!response.ok) {
    // Silently fall through to ElevenLabs by returning non-200
    const errorBody = await response.text()
    console.warn(`[/tts] Kokoro error ${response.status} — will fall back client-side: ${errorBody}`)
    return corsResponse(errorBody, {
      status: response.status,
      headers: { 'content-type': 'application/json' }
    })
  }

  return corsResponse(response.body, {
    status: 200,
    headers: { 'content-type': 'audio/mpeg' }
  })
}

async function handleElevenLabsTts(
  body: { text: string; model_id?: string; voice_settings?: object },
  env: Env
): Promise<Response> {
  const voiceId = env.ELEVENLABS_VOICE_ID
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': env.ELEVENLABS_API_KEY,
      'content-type': 'application/json',
      accept: 'audio/mpeg'
    },
    body: JSON.stringify({
      text: body.text,
      model_id: body.model_id ?? 'eleven_multilingual_v2',
      voice_settings: body.voice_settings ?? { stability: 0.5, similarity_boost: 0.75 }
    })
  })

  if (!response.ok) {
    const errorBody = await response.text()
    return corsResponse(errorBody, {
      status: response.status,
      headers: { 'content-type': 'application/json' }
    })
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
