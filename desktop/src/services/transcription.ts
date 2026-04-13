/**
 * Transcription service — proxied through server.
 *
 * The client POSTs raw WAV bytes to POST /transcribe on the proxy.
 * The proxy owns all AssemblyAI API calls (upload → submit → poll) using
 * its server-side API key, and returns { text: string } when done.
 *
 * Previous approach (POST /transcribe-token then calling AssemblyAI directly)
 * was broken: the streaming v3 token it returned is only valid for WebSocket
 * real-time transcription, not for the batch v2 REST API used here.
 *
 * If transcription fails the pipeline continues with an empty transcript so
 * Claude still responds to the screenshot.
 */

import { net } from 'electron'

export async function transcribeAudio(wavBuffer: Buffer, proxyUrl: string): Promise<string> {
  if (wavBuffer.length === 0) {
    console.warn('[transcription] No audio recorded')
    return ''
  }

  console.info('[transcription] Sending audio to proxy for transcription —', wavBuffer.length, 'bytes')

  try {
    const res = await (net.fetch as typeof fetch)(`${proxyUrl}/transcribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array(wavBuffer),
    })

    if (!res.ok) {
      const errorText = await res.text()
      console.error(`[transcription] Proxy error ${res.status}:`, errorText)
      throw new Error(`transcription proxy error ${res.status}: ${errorText}`)
    }

    const { text } = await res.json() as { text: string }
    const transcript = text?.trim() ?? ''
    console.info('[transcription] Result:', transcript || '(empty)')
    return transcript
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[transcription] FAILED:', msg)
    console.error('[transcription] AI will only see the screenshot. Check ASSEMBLYAI_API_KEY in proxy/.env')
    return ''
  }
}
