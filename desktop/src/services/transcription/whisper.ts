/**
 * Audio transcription service — Whisper (local) primary, AssemblyAI fallback.
 *
 * Ported from AssemblyAIStreamingTranscriptionProvider.swift (Clicky).
 *
 * Phase 1 implementation:
 *  - Primary: whisper.cpp via the proxy endpoint (POST /transcribe)
 *    The proxy receives the WAV buffer and runs Whisper server-side so
 *    we don't need to bundle a native binary in the Electron app.
 *  - Fallback: AssemblyAI (needs API key on proxy)
 *
 * Phase 2 TODO: Add local whisper.cpp via node native addon for full offline use.
 */

// Proxy URL — updated at runtime by vision.ts's setProxyUrl
let proxyUrl = 'https://mwongozo-proxy.workers.dev'

export function setTranscriptionProxyUrl(url: string): void {
  proxyUrl = url
}

/**
 * Transcribe a WAV buffer to text.
 * Returns the transcript string, or empty string if transcription failed.
 */
export async function transcribeAudio(wavBuffer: Buffer): Promise<string> {
  if (wavBuffer.length === 0) {
    return ''
  }

  // Try Whisper via proxy first
  try {
    const result = await transcribeViaProxy(wavBuffer)
    console.info(`[transcription] Whisper result: "${result}"`)
    return result
  } catch (err) {
    console.warn('[transcription] Whisper proxy failed, trying AssemblyAI:', err)
  }

  // Fallback to AssemblyAI token-based streaming
  try {
    const result = await transcribeViaAssemblyAI(wavBuffer)
    console.info(`[transcription] AssemblyAI result: "${result}"`)
    return result
  } catch (err) {
    console.error('[transcription] All transcription providers failed:', err)
    return ''
  }
}

// ---------------------------------------------------------------------------
// Whisper via proxy
// ---------------------------------------------------------------------------

async function transcribeViaProxy(wavBuffer: Buffer): Promise<string> {
  const response = await fetch(`${proxyUrl}/transcribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'audio/wav',
      'X-Language': 'sw'  // Swahili default — proxy passes this to Whisper
    },
    body: wavBuffer
  })

  if (!response.ok) {
    throw new Error(`Transcription proxy error ${response.status}: ${await response.text()}`)
  }

  const data = (await response.json()) as { text: string }
  return data.text?.trim() ?? ''
}

// ---------------------------------------------------------------------------
// AssemblyAI fallback (non-streaming, sends full WAV)
// ---------------------------------------------------------------------------

async function transcribeViaAssemblyAI(wavBuffer: Buffer): Promise<string> {
  // Step 1: Get a short-lived upload token from our proxy
  const tokenResponse = await fetch(`${proxyUrl}/transcribe-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  })

  if (!tokenResponse.ok) {
    throw new Error(`AssemblyAI token error: ${tokenResponse.status}`)
  }

  const { upload_url: uploadUrl } = (await tokenResponse.json()) as { upload_url: string }

  // Step 2: Upload the audio
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/wav' },
    body: wavBuffer
  })

  if (!uploadResponse.ok) {
    throw new Error(`AssemblyAI upload error: ${uploadResponse.status}`)
  }

  const { upload_url: audioUrl } = (await uploadResponse.json()) as { upload_url: string }

  // Step 3: Request transcription
  const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio_url: audioUrl, language_code: 'sw' })
  })

  if (!transcriptResponse.ok) {
    throw new Error(`AssemblyAI transcript request error: ${transcriptResponse.status}`)
  }

  const { id: transcriptId } = (await transcriptResponse.json()) as { id: string }

  // Step 4: Poll for completion
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const pollResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`)
    const pollData = (await pollResponse.json()) as { status: string; text?: string }

    if (pollData.status === 'completed') {
      return pollData.text?.trim() ?? ''
    }
    if (pollData.status === 'error') {
      throw new Error('AssemblyAI transcription error')
    }
  }

  throw new Error('AssemblyAI transcription timed out')
}
