/**
 * Mwongozo Proxy — Cloudflare Worker
 *
 * Routes:
 * POST /chat → AI model (OpenRouter OR BigModel.cn)
 * POST /tts → ElevenLabs text-to-speech
 * POST /transcribe-token → AssemblyAI short-lived token
 *
 * Environment Variables:
 * - OPENROUTER_API_KEY: For OpenRouter models
 * - BIGMODEL_API_KEY: For GLM-5V-Turbo on BigModel.cn
 * - ELEVENLABS_API_KEY: For text-to-speech
 * - ELEVENLABS_VOICE_ID: Default voice ID
 * - ASSEMBLYAI_API_KEY: For transcription
 */

interface Env {
  // AI Providers (at least one required)
  OPENROUTER_API_KEY?: string
  BIGMODEL_API_KEY?: string
  // TTS
  ELEVENLABS_API_KEY: string
  ELEVENLABS_VOICE_ID: string
  // Transcription
  ASSEMBLYAI_API_KEY: string
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
      if (pathname === '/chat') return await handleChat(request, env)
      if (pathname === '/tts') return await handleTts(request, env)
      if (pathname === '/transcribe-token') return await handleTranscribeToken(env)
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
// /transcribe-token — AssemblyAI short-lived token for WebSocket streaming
// ---------------------------------------------------------------------------

async function handleTranscribeToken(env: Env): Promise<Response> {
  if (!env.ASSEMBLYAI_API_KEY) {
    console.error('[transcribe-token] ERROR: ASSEMBLYAI_API_KEY not configured')
    return ok(JSON.stringify({ error: 'ASSEMBLYAI_API_KEY not configured' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  console.info('[transcribe-token] Requesting token from AssemblyAI...')
  const upstream = await fetch(
    'https://streaming.assemblyai.com/v3/token?expires_in_seconds=480',
    { headers: { authorization: env.ASSEMBLYAI_API_KEY } }
  )

  if (!upstream.ok) {
    const err = await upstream.text()
    console.error('[transcribe-token] ERROR: AssemblyAI returned', upstream.status, err)
    return ok(JSON.stringify({ error: `AssemblyAI error ${upstream.status}`, details: err }), {
      status: upstream.status,
      headers: { 'content-type': 'application/json' },
    })
  }

  console.info('[transcribe-token] Token obtained successfully')
  return ok(await upstream.text(), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
