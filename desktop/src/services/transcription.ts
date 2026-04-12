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
  if (wavBuffer.length === 0) return ''

  try {
    // Step 1: get a short-lived upload token from our proxy
    const tokenRes = await (net.fetch as typeof fetch)(`${proxyUrl}/transcribe-token`, {
      method: 'POST',
    })
    if (!tokenRes.ok) throw new Error(`token error ${tokenRes.status}`)
    const { token } = await tokenRes.json() as { token: string }

    // Step 2: upload audio directly to AssemblyAI
    const uploadRes = await (net.fetch as typeof fetch)('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: {
        authorization: token,
        'content-type': 'application/octet-stream',
      },
      body: new Uint8Array(wavBuffer),
    })
    if (!uploadRes.ok) throw new Error(`upload error ${uploadRes.status}`)
    const { upload_url } = await uploadRes.json() as { upload_url: string }

    // Step 3: request transcription
    const txRes = await (net.fetch as typeof fetch)('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify({ audio_url: upload_url }),
    })
    if (!txRes.ok) throw new Error(`transcript request error ${txRes.status}`)
    const { id } = await txRes.json() as { id: string }

    // Step 4: poll for result (max 15 attempts × 1.5s = 22.5s)
    for (let i = 0; i < 15; i++) {
      await sleep(1500)
      const poll = await (net.fetch as typeof fetch)(
        `https://api.assemblyai.com/v2/transcript/${id}`,
        { headers: { authorization: token } }
      )
      const data = await poll.json() as { status: string; text?: string }
      if (data.status === 'completed') return data.text?.trim() ?? ''
      if (data.status === 'error') throw new Error('AssemblyAI transcription error')
    }

    throw new Error('Transcription timed out')
  } catch (err) {
    // Non-fatal — log and continue with empty transcript
    console.warn('[transcription] Failed, proceeding without text:', err)
    return ''
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
