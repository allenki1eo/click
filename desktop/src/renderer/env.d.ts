/**
 * Global type declarations for the renderer context.
 * Mirrors the contextBridge API exposed in src/preload/index.ts.
 */

import type { CompanionStatus, Message, OrbConfig, PointTarget } from '../shared/types'

declare global {
  // ── Web Speech API (Chromium / Electron renderer) ─────────────────────────
  interface SpeechRecognition extends EventTarget {
    continuous: boolean
    interimResults: boolean
    lang: string
    start(): void
    stop(): void
    abort(): void
    onresult: ((event: SpeechRecognitionEvent) => void) | null
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
    onend: (() => void) | null
  }
  // eslint-disable-next-line no-var
  var SpeechRecognition: { prototype: SpeechRecognition; new(): SpeechRecognition }

  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number
    readonly results: SpeechRecognitionResultList
  }
  interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string
    readonly message: string
  }
  interface SpeechRecognitionResultList {
    readonly length: number
    item(index: number): SpeechRecognitionResult
    [index: number]: SpeechRecognitionResult
  }
  interface SpeechRecognitionResult {
    readonly isFinal: boolean
    readonly length: number
    item(index: number): SpeechRecognitionAlternative
    [index: number]: SpeechRecognitionAlternative
  }
  interface SpeechRecognitionAlternative {
    readonly transcript: string
    readonly confidence: number
  }

  // ── Window extensions ──────────────────────────────────────────────────────
  interface Window {
    webkitSpeechRecognition: { prototype: SpeechRecognition; new(): SpeechRecognition }

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

      // Overlay — cursor pointing
      onOverlayPoint: (cb: (p: PointTarget) => void) => () => void
      onOverlayText: (cb: (t: string) => void) => () => void
      onOverlayHide: (cb: () => void) => () => void

      // Overlay — streaming response bubble near cursor
      onOverlayResponseStart: (cb: (pos: { x: number; y: number }) => void) => () => void
      onOverlayResponseChunk: (cb: (chunk: string) => void) => () => void
      onOverlayResponseDone: (cb: () => void) => () => void

      // Manual text query
      submitQuery: (text: string) => Promise<void>

      // Orb
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onCursorMove: (cb: (d: any) => void) => () => void
      orbClick: () => void

      // Orb customisation
      getOrbConfig: () => Promise<OrbConfig>
      setOrbConfig: (cfg: Partial<OrbConfig>) => Promise<void>
      onOrbConfig: (cb: (cfg: OrbConfig) => void) => () => void

      // Proxy URL
      getProxyUrl: () => Promise<string>
      setProxyUrl: (url: string) => Promise<void>

      // Org ID (white-labeling)
      getOrgId: () => Promise<string>
      setOrgId: (id: string) => Promise<void>

      // Voice transcription
      transcribeAudio: (b64: string) => Promise<string>

      // Persistent conversation history
      getHistory: () => Promise<Message[]>
    }
  }
}
