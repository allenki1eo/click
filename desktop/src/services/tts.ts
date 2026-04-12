/**
 * TTS service — mirrors ElevenLabsTTSClient.swift.
 *
 * Primary:  ElevenLabs via proxy /tts  → MP3 sent to panel renderer for Web Audio playback
 * Fallback: Web Speech API (built into Windows/macOS, needs no server)
 *
 * The main process never plays audio directly — it sends the base64 MP3 to
 * the panel renderer which plays it via the Web Audio API, then acks back.
 * This is the only clean way to play audio from an Electron main process.
 */

import { net } from 'electron'
import type { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'

let panelWindow: BrowserWindow | null = null

export function setTtsWindow(win: BrowserWindow): void {
  panelWindow = win
}

export async function speak(text: string, proxyUrl: string): Promise<void> {
  // Try ElevenLabs first
  try {
    await speakViaElevenLabs(text, proxyUrl)
    return
  } catch (err) {
    console.warn('[tts] ElevenLabs failed, falling back to Web Speech:', err)
  }

  // Fallback: ask renderer to use the browser's speech synthesis
  await speakViaWebSpeech(text)
}

// ---------------------------------------------------------------------------
// ElevenLabs — fetch MP3 from proxy, send to renderer for playback
// ---------------------------------------------------------------------------

async function speakViaElevenLabs(text: string, proxyUrl: string): Promise<void> {
  const response = await (net.fetch as typeof fetch)(`${proxyUrl}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })

  if (!response.ok) {
    throw new Error(`TTS proxy error ${response.status}: ${await response.text()}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')

  await new Promise<void>((resolve, reject) => {
    if (!panelWindow || panelWindow.isDestroyed()) {
      reject(new Error('Panel window not available for TTS playback'))
      return
    }

    // One-shot listener: renderer acks when playback finishes
    const { ipcMain } = require('electron') as typeof import('electron')
    ipcMain.once(IPC.TTS_DONE, () => resolve())

    panelWindow.webContents.send(IPC.TTS_PLAY, base64)

    // Safety timeout — if renderer never acks, don't hang forever
    setTimeout(() => resolve(), 30_000)
  })
}

// ---------------------------------------------------------------------------
// Web Speech API fallback — renderer speaks via SpeechSynthesis
// ---------------------------------------------------------------------------

async function speakViaWebSpeech(text: string): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!panelWindow || panelWindow.isDestroyed()) { resolve(); return }

    const { ipcMain } = require('electron') as typeof import('electron')
    ipcMain.once(IPC.TTS_WEB_SPEECH_DONE, () => resolve())

    panelWindow.webContents.send(IPC.TTS_WEB_SPEECH, text)

    setTimeout(() => resolve(), 30_000)
  })
}
