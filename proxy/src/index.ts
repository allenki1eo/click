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
      if (pathname === '/transcribe') return await handleTranscribe(request, env)
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
// /transcribe — Full AssemblyAI pipeline: upload → submit → poll → return text
// Client POSTs raw audio bytes; proxy handles all API calls with the server key.
// ---------------------------------------------------------------------------

async function handleTranscribe(request: Request, env: Env): Promise<Response> {
  if (!env.ASSEMBLYAI_API_KEY) {
    return ok(JSON.stringify({ error: 'ASSEMBLYAI_API_KEY not configured. Add it to Worker secrets.' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  const audioBuffer = await request.arrayBuffer()
  if (!audioBuffer.byteLength) {
    return ok(JSON.stringify({ error: 'No audio data received', text: '' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }
  console.info(`[transcribe] Received ${audioBuffer.byteLength} bytes`)

  const auth = env.ASSEMBLYAI_API_KEY

  // Step 1: Upload audio
  const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/octet-stream' },
    body: audioBuffer,
  })
  if (!uploadRes.ok) {
    const err = await uploadRes.text()
    return ok(JSON.stringify({ error: `Upload failed: ${err}`, text: '' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
  const { upload_url } = await uploadRes.json() as { upload_url: string }
  console.info('[transcribe] Audio uploaded')

  // Step 2: Submit transcription job
  const txRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify({ audio_url: upload_url }),
  })
  if (!txRes.ok) {
    const err = await txRes.text()
    return ok(JSON.stringify({ error: `Transcript submit failed: ${err}`, text: '' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
  const { id } = await txRes.json() as { id: string }
  console.info('[transcribe] Job submitted, ID:', id)

  // Step 3: Poll until completed (max 20 × 1.5s = 30s)
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1500))
    const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { authorization: auth },
    })
    const data = await poll.json() as { status: string; text?: string; error?: string }
    if (data.status === 'completed') {
      const text = data.text?.trim() ?? ''
      console.info('[transcribe] Completed:', text || '(empty)')
      return ok(JSON.stringify({ text }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (data.status === 'error') {
      return ok(JSON.stringify({ error: `AssemblyAI: ${data.error}`, text: '' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    }
    console.info(`[transcribe] Status: ${data.status} (${i + 1}/20)`)
  }

  return ok(JSON.stringify({ error: 'Transcription timed out', text: '' }), {
    status: 500,
    headers: { 'content-type': 'application/json' },
  })
}
