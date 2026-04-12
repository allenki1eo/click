/**
 * Mwongozo Proxy — Cloudflare Worker
 *
 * Mirrors clicky's worker exactly: 3 routes, API keys never leave the server.
 *
 *   POST /chat            → Claude via OpenRouter (streaming SSE, OpenAI-compatible)
 *   POST /tts             → ElevenLabs text-to-speech
 *   POST /transcribe-token → AssemblyAI short-lived token
 */

interface Env {
  OPENROUTER_API_KEY: string
  ELEVENLABS_API_KEY: string
  ELEVENLABS_VOICE_ID: string   // default voice, e.g. "21m00Tcm4TlvDq8ikWAM"
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
      if (pathname === '/chat')             return await handleChat(request, env)
      if (pathname === '/tts')              return await handleTts(request, env)
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
// /chat — Claude via OpenRouter (OpenAI-compatible SSE passthrough)
// ---------------------------------------------------------------------------

async function handleChat(request: Request, env: Env): Promise<Response> {
  const body = await request.text()

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
    console.error('/chat upstream error', upstream.status, err)
    return ok(err, { status: upstream.status, headers: { 'content-type': 'application/json' } })
  }

  // Pass the SSE stream straight through — no buffering
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
  const upstream = await fetch(
    'https://streaming.assemblyai.com/v3/token?expires_in_seconds=480',
    { headers: { authorization: env.ASSEMBLYAI_API_KEY } }
  )

  if (!upstream.ok) {
    const err = await upstream.text()
    console.error('/transcribe-token upstream error', upstream.status, err)
    return ok(err, { status: upstream.status })
  }

  return ok(await upstream.text(), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
