/**
 * Global type declarations for the renderer context.
 * Mirrors the contextBridge API exposed in src/preload/index.ts.
 */

import type { CompanionStatus, PointTarget } from '../shared/types'

declare global {
  interface Window {
    api: {
      // Status
      getStatus: () => Promise<CompanionStatus>
      onStatus: (cb: (s: CompanionStatus) => void) => () => void
      reset: () => Promise<void>

      // Hotkey
      onHotkeyPress: (cb: () => void) => () => void
      onHotkeyRelease: (cb: () => void) => () => void

      // Audio
      sendAudioChunk: (b64: string) => void
      sendAudioStop: () => void

      // Claude streaming
      onClaudeChunk: (cb: (chunk: string) => void) => () => void
      onClaudeDone: (cb: () => void) => () => void

      // TTS
      onTtsPlay: (cb: (b64: string) => void) => () => void
      notifyTtsDone: () => void
      onWebSpeech: (cb: (text: string) => void) => () => void
      notifyWebSpeechDone: () => void

      // Overlay
      onOverlayPoint: (cb: (p: PointTarget) => void) => () => void
      onOverlayText: (cb: (t: string) => void) => () => void
      onOverlayHide: (cb: () => void) => () => void
    }
  }
}
