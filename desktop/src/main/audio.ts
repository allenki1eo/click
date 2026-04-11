/**
 * Audio pipeline — receives mic chunks from the renderer, assembles them,
 * and hands the combined WAV to the CompanionManager for transcription.
 *
 * Ported from BuddyDictationManager.swift + BuddyAudioConversionSupport.swift.
 *
 * Architecture decision: mic capture is done in the renderer process via the
 * Web Audio API (navigator.mediaDevices.getUserMedia) because:
 *  1. Renderer already has microphone permission via the OS permission prompt
 *  2. Web Audio API gives us fine-grained PCM access without native bindings
 *  3. Avoids native node module (node-mic) which complicates cross-platform builds
 *
 * The renderer sends base64-encoded WAV chunks over IPC. This file receives
 * them and feeds them to the CompanionManager.
 */

import { ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import type { CompanionManager } from './companion'

interface AudioHandlerOptions {
  companionManager: CompanionManager
}

export function registerAudioHandlers(options: AudioHandlerOptions): void {
  const { companionManager } = options

  // Renderer sends each chunk as a base64 WAV blob while push-to-talk is held
  ipcMain.on(IPC.AUDIO.CHUNK, (_, wavBase64: string) => {
    companionManager.onAudioChunk(wavBase64)
  })

  // Renderer sends this when it stops recording (belt-and-suspenders for hotkey release)
  ipcMain.on(IPC.AUDIO.STOP, () => {
    // CompanionManager handles this via onHotkeyRelease — no separate action needed
  })
}
