/**
 * Transcription service — AssemblyAI batch (Phase 1).
 *
 * Mirrors BuddyDictationManager.swift's approach: audio is collected during
 * PTT hold, then sent for transcription on release.
 *
 * Phase 1 uses AssemblyAI's REST API (upload + poll) via the proxy token.
 * Phase 2 TODO: real-time WebSocket streaming (like clicky's websocket flow).
 *
 * If AssemblyAI is unavailable (no key), returns empty string — the pipeline
 * continues with whatever the user said as an empty query, and Claude responds
 * to the screenshot alone.
 */

import { net } from 'electron'

export async function transcribeAudio(wavBuffer: Buffer, proxyUrl: string): Promise<string> {
  if (wavBuffer.length === 0) {
    console.warn('[transcription] No audio recorded')
    return ''
  }

  console.info('[transcription] Starting transcription... Audio size:', wavBuffer.length, 'bytes')

  try {
    // Step 1: get a short-lived upload token from our proxy
    console.info('[transcription] Getting token from proxy...')
    const tokenRes = await (net.fetch as typeof fetch)(`${proxyUrl}/transcribe-token`, {
      method: 'POST',
    })
    if (!tokenRes.ok) {
      const errorText = await tokenRes.text()
      console.error(`[transcription] Token error: ${tokenRes.status} - ${errorText}`)
      throw new Error(`token error ${tokenRes.status}: ${errorText}`)
    }
    const { token } = await tokenRes.json() as { token: string }
    console.info('[transcription] Got token successfully')

    // Step 2: upload audio directly to AssemblyAI
    console.info('[transcription] Uploading audio to AssemblyAI...')
    const uploadRes = await (net.fetch as typeof fetch)('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: {
        authorization: token,
        'content-type': 'application/octet-stream',
      },
      body: new Uint8Array(wavBuffer),
    })
    if (!uploadRes.ok) {
      const errorText = await uploadRes.text()
      console.error(`[transcription] Upload error: ${uploadRes.status} - ${errorText}`)
      throw new Error(`upload error ${uploadRes.status}: ${errorText}`)
    }
    const { upload_url } = await uploadRes.json() as { upload_url: string }
    console.info('[transcription] Audio uploaded successfully')

    // Step 3: request transcription
    console.info('[transcription] Requesting transcription...')
    const txRes = await (net.fetch as typeof fetch)('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify({ audio_url: upload_url }),
    })
    if (!txRes.ok) {
      const errorText = await txRes.text()
      console.error(`[transcription] Transcript request error: ${txRes.status} - ${errorText}`)
      throw new Error(`transcript request error ${txRes.status}: ${errorText}`)
    }
    const { id } = await txRes.json() as { id: string }
    console.info('[transcription] Transcription job started, ID:', id)

    // Step 4: poll for result (max 15 attempts × 1.5s = 22.5s)
    console.info('[transcription] Polling for result...')
    for (let i = 0; i < 15; i++) {
      await sleep(1500)
      const poll = await (net.fetch as typeof fetch)(
        `https://api.assemblyai.com/v2/transcript/${id}`,
        { headers: { authorization: token } }
      )
      const data = await poll.json() as { status: string; text?: string; error?: string }
      
      if (data.status === 'completed') {
        const transcript = data.text?.trim() ?? ''
        console.info('[transcription] Transcription completed:', transcript || '(empty)')
        return transcript
      }
      if (data.status === 'error') {
        console.error('[transcription] AssemblyAI error:', data.error)
        throw new Error(`AssemblyAI transcription error: ${data.error}`)
      }
    }

    throw new Error('Transcription timed out')
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error('[transcription] FAILED:', errorMessage)
    console.error('[transcription] The AI will only see the screenshot, not your spoken question.')
    console.error('[transcription] To fix: check your ASSEMBLYAI_API_KEY in proxy/.env')
    return ''
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
