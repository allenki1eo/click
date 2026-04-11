/**
 * Text-to-speech service.
 *
 * Ported from ElevenLabsTTSClient.swift (Clicky).
 * ElevenLabs removed — replaced with free/open-source alternatives.
 *
 * Provider chain (tried in order):
 *  1. edge-tts  — Microsoft Edge neural voices via proxy WebSocket relay.
 *                 No API key required. Has sw-TZ-DaudiNeural (Tanzanian Swahili).
 *  2. Piper TTS — Open-source, self-hostable, offline-capable.
 *                 Good Swahili model: sw_CD-akashic-medium.
 *  3. Web Speech API — Built into Windows/browser, zero server deps.
 *                 Used as emergency fallback when proxy is unreachable.
 *
 * Audio playback uses the Web Audio API in the panel renderer — main process
 * has no audio context, so we IPC the MP3 buffer to the renderer to play.
 */

import { BrowserWindow, ipcMain } from 'electron'

let proxyUrl = 'https://mwongozo-proxy.workers.dev'
let panelWindowRef: BrowserWindow | null = null

export function setTtsProxyUrl(url: string): void {
  proxyUrl = url
}

export function setTtsPanelWindow(win: BrowserWindow): void {
  panelWindowRef = win
}

// ---------------------------------------------------------------------------
// Voice map — best available per language
// ---------------------------------------------------------------------------

const VOICES: Record<'sw' | 'en', { edge: string; piper: string }> = {
  sw: {
    // Tanzanian Swahili neural voice (male) — DaudiNeural sounds the most natural
    // Alternative: sw-KE-ZuriNeural (Kenyan Swahili, female)
    edge: 'sw-TZ-DaudiNeural',
    piper: 'sw_CD-akashic-medium'
  },
  en: {
    edge: 'en-GB-SoniaNeural',
    piper: 'en_US-lessac-medium'
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Speak the given text aloud using TTS.
 * Tries providers in order until one succeeds.
 */
export async function speak(text: string, language: 'sw' | 'en' = 'sw'): Promise<void> {
  if (!text.trim()) return

  const cleanText = stripMarkdown(text)

  // 1. Try edge-tts via proxy
  try {
    const audioBuffer = await fetchEdgeTtsAudio(cleanText, language)
    await playAudioInRenderer(audioBuffer)
    return
  } catch (err) {
    console.warn('[tts] edge-tts failed, trying Piper:', (err as Error).message)
  }

  // 2. Try Piper TTS via proxy
  try {
    const audioBuffer = await fetchPiperAudio(cleanText, language)
    await playAudioInRenderer(audioBuffer)
    return
  } catch (err) {
    console.warn('[tts] Piper failed, falling back to Web Speech API:', (err as Error).message)
  }

  // 3. Web Speech API fallback — tell renderer to speak locally
  await speakViaWebSpeechApi(cleanText, language)
}

// ---------------------------------------------------------------------------
// Provider 1: edge-tts (free, no key, great Swahili voices)
// ---------------------------------------------------------------------------

async function fetchEdgeTtsAudio(text: string, language: 'sw' | 'en'): Promise<Buffer> {
  const voice = VOICES[language].edge
  const response = await fetch(`${proxyUrl}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'edge', text, voice, language }),
    // Keep timeout reasonable — edge-tts WebSocket relay takes ~2-4s
    signal: AbortSignal.timeout(15_000)
  })

  if (!response.ok) {
    throw new Error(`edge-tts proxy error ${response.status}: ${await response.text()}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  if (arrayBuffer.byteLength === 0) {
    throw new Error('edge-tts returned empty audio')
  }
  return Buffer.from(arrayBuffer)
}

// ---------------------------------------------------------------------------
// Provider 2: Piper TTS (open-source, self-hostable)
// ---------------------------------------------------------------------------

async function fetchPiperAudio(text: string, language: 'sw' | 'en'): Promise<Buffer> {
  const voice = VOICES[language].piper
  const response = await fetch(`${proxyUrl}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'piper', text, voice }),
    signal: AbortSignal.timeout(15_000)
  })

  if (!response.ok) {
    throw new Error(`Piper TTS proxy error ${response.status}: ${await response.text()}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  if (arrayBuffer.byteLength === 0) {
    throw new Error('Piper returned empty audio')
  }
  return Buffer.from(arrayBuffer)
}

// ---------------------------------------------------------------------------
// Provider 3: Web Speech API (renderer-side, zero deps, always available)
// ---------------------------------------------------------------------------

/**
 * Send an IPC message to the panel renderer asking it to use the browser's
 * built-in speech synthesis. On Windows 10/11 this uses Microsoft neural voices.
 */
async function speakViaWebSpeechApi(text: string, language: 'sw' | 'en'): Promise<void> {
  if (!panelWindowRef || panelWindowRef.isDestroyed()) {
    console.error('[tts] No panel window for Web Speech API fallback')
    return
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 30_000)
    panelWindowRef!.webContents.send('TTS:WEB_SPEECH', { text, language })
    ipcMain.once('TTS:WEB_SPEECH_DONE', () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

// ---------------------------------------------------------------------------
// Audio playback via renderer
// ---------------------------------------------------------------------------

async function playAudioInRenderer(audioBuffer: Buffer): Promise<void> {
  if (!panelWindowRef || panelWindowRef.isDestroyed()) {
    console.warn('[tts] Panel window unavailable for audio playback')
    return
  }

  return new Promise((resolve) => {
    const base64Audio = audioBuffer.toString('base64')
    const timeout = setTimeout(resolve, 30_000)
    panelWindowRef!.webContents.send('TTS:PLAY_AUDIO', base64Audio)
    ipcMain.once('TTS:AUDIO_DONE', () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

// ---------------------------------------------------------------------------
// Utility: strip markdown formatting before speaking
// ---------------------------------------------------------------------------

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')   // bold
    .replace(/\*(.+?)\*/g, '$1')        // italic
    .replace(/`(.+?)`/g, '$1')          // inline code
    .replace(/#+\s/g, '')               // headings
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // links → label only
    .trim()
}
