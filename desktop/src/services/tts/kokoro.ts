/**
 * Text-to-speech service — Kokoro TTS (local) primary, ElevenLabs fallback.
 *
 * Ported from ElevenLabsTTSClient.swift (Clicky).
 *
 * Phase 1 implementation:
 *  - Primary: Kokoro TTS via proxy (POST /tts)
 *    The proxy runs Kokoro server-side and returns audio/mpeg
 *  - Fallback: ElevenLabs (existing proxy route from Clicky)
 *
 * Audio playback uses the Web Audio API via the main process → renderer IPC.
 * We cannot play audio directly from the main process (no Web Audio there),
 * so we send the audio buffer to the panel renderer for playback.
 *
 * Phase 2 TODO: Bundle kokoro.cpp as a native addon for fully offline TTS.
 */

import { BrowserWindow } from 'electron'

let proxyUrl = 'https://mwongozo-proxy.workers.dev'
let panelWindowRef: BrowserWindow | null = null

export function setTtsProxyUrl(url: string): void {
  proxyUrl = url
}

export function setTtsPanelWindow(win: BrowserWindow): void {
  panelWindowRef = win
}

/**
 * Speak the given text aloud using TTS.
 * Blocks until TTS audio has finished playing.
 */
export async function speak(text: string, language: 'sw' | 'en' = 'sw'): Promise<void> {
  if (!text.trim()) return

  let audioBuffer: Buffer | null = null

  // Try Kokoro first
  try {
    audioBuffer = await fetchKokoroAudio(text, language)
    console.info('[tts] Kokoro audio fetched')
  } catch (err) {
    console.warn('[tts] Kokoro failed, trying ElevenLabs:', err)
  }

  // Fall back to ElevenLabs
  if (!audioBuffer) {
    try {
      audioBuffer = await fetchElevenLabsAudio(text)
      console.info('[tts] ElevenLabs audio fetched')
    } catch (err) {
      console.error('[tts] All TTS providers failed:', err)
      return
    }
  }

  // Send audio to the panel renderer for playback
  await playAudioInRenderer(audioBuffer)
}

// ---------------------------------------------------------------------------
// Kokoro TTS
// ---------------------------------------------------------------------------

async function fetchKokoroAudio(text: string, language: 'sw' | 'en'): Promise<Buffer> {
  const response = await fetch(`${proxyUrl}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'kokoro',
      text,
      language,
      // Swahili-accented voice for authenticity
      voice: language === 'sw' ? 'af_sarah' : 'af_sky',
      speed: 1.0
    })
  })

  if (!response.ok) {
    throw new Error(`Kokoro TTS error ${response.status}: ${await response.text()}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

// ---------------------------------------------------------------------------
// ElevenLabs fallback
// ---------------------------------------------------------------------------

async function fetchElevenLabsAudio(text: string): Promise<Buffer> {
  const response = await fetch(`${proxyUrl}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'elevenlabs',
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 }
    })
  })

  if (!response.ok) {
    throw new Error(`ElevenLabs TTS error ${response.status}: ${await response.text()}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

// ---------------------------------------------------------------------------
// Audio playback via renderer (panel window)
// ---------------------------------------------------------------------------

/**
 * Send the audio buffer to the panel window renderer for Web Audio playback.
 * Returns a Promise that resolves when playback is complete.
 */
async function playAudioInRenderer(audioBuffer: Buffer): Promise<void> {
  if (!panelWindowRef || panelWindowRef.isDestroyed()) {
    console.warn('[tts] Panel window not available for audio playback')
    return
  }

  return new Promise((resolve) => {
    const base64Audio = audioBuffer.toString('base64')

    // Send audio to renderer; renderer replies via IPC when done
    panelWindowRef!.webContents.send('TTS:PLAY_AUDIO', base64Audio)

    // Timeout safety net — resolve after 30s max even if renderer doesn't reply
    const timeout = setTimeout(resolve, 30_000)

    // Listen for renderer's "I'm done playing" reply
    const { ipcMain } = require('electron')
    const cleanup = (): void => {
      clearTimeout(timeout)
      resolve()
    }
    ipcMain.once('TTS:AUDIO_DONE', cleanup)
  })
}
