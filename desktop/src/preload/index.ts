/**
 * Preload bridge — exposes a safe, typed API to renderer processes.
 *
 * contextBridge ensures renderers cannot access raw Node.js or Electron APIs.
 * window.electronAPI is the ONLY IPC contract between main and renderer.
 *
 * Security: expose the minimum needed. Each method maps to exactly one channel.
 */

import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  OrgProfile,
  ActivateCodeRequest,
  ActivateCodeResponse,
  CompanionStatus,
  GuidanceResult,
  FlowContext,
  Flow,
  PointTarget
} from '../shared/types'

// ---------------------------------------------------------------------------
// API surface type
// ---------------------------------------------------------------------------

export interface ElectronAPI {
  // Screenshot
  captureScreen: () => Promise<string>

  // Flow
  loadFlow: (flowId: string) => Promise<Flow | null>
  getFlowState: () => Promise<FlowContext | null>
  setFlowStep: (step: number) => Promise<void>
  nextFlowStep: () => Promise<void>

  // Companion
  getCompanionStatus: () => Promise<CompanionStatus>
  resetCompanion: () => Promise<void>
  onStateChange: (callback: (status: CompanionStatus) => void) => () => void
  onFlowStepChanged: (callback: (context: FlowContext) => void) => () => void

  // Hotkey events (main → renderer notifications)
  onHotkeyPress: (callback: () => void) => () => void
  onHotkeyRelease: (callback: () => void) => () => void

  // Audio (renderer captures mic, sends to main for transcription)
  sendAudioChunk: (wavBase64: string) => void
  sendAudioStop: () => void

  // Transcription
  onTranscriptionResult: (callback: (text: string) => void) => () => void

  // Vision / guidance
  requestGuidance: (userQuery: string) => Promise<GuidanceResult>
  onGuidanceResult: (callback: (result: GuidanceResult) => void) => () => void

  // TTS — main → renderer: play audio
  onPlayAudio: (callback: (base64mp3: string) => void) => () => void
  /** Renderer calls this when Web Audio playback finishes */
  notifyAudioDone: () => void

  // TTS — main → renderer: speak via Web Speech API (offline fallback)
  onWebSpeech: (callback: (payload: { text: string; language: string }) => void) => () => void
  /** Renderer calls this when Web Speech utterance finishes */
  notifyWebSpeechDone: () => void

  // Overlay
  overlayShow: () => void
  overlayHide: () => void
  overlayPoint: (point: PointTarget) => void
  overlaySetText: (text: string) => void
  onOverlayPoint: (callback: (point: PointTarget) => void) => () => void
  onOverlaySetText: (callback: (text: string) => void) => () => void
  onOverlayHide: (callback: () => void) => () => void

  // Config / org profile
  getProfile: () => Promise<OrgProfile | null>
  activateCode: (request: ActivateCodeRequest) => Promise<ActivateCodeResponse>
  clearProfile: () => Promise<void>

  // Window management
  showOnboarding: () => Promise<void>
  closeOnboarding: () => Promise<void>
  togglePanel: () => Promise<void>

  // Session analytics (fire-and-forget)
  logSession: (event: object) => void
}

// ---------------------------------------------------------------------------
// Helper: subscribe to an IPC event, return an unsubscribe function.
// React components use the return value in useEffect cleanup.
// ---------------------------------------------------------------------------

function onEvent<T>(channel: string, callback: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

// Zero-payload variant (hotkey press/release, TTS done, etc.)
function onSignal(channel: string, callback: () => void): () => void {
  const handler = (): void => callback()
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

// ---------------------------------------------------------------------------
// Bridge implementation
// ---------------------------------------------------------------------------

const api: ElectronAPI = {
  captureScreen: () => ipcRenderer.invoke(IPC.SCREENSHOT.CAPTURE),

  loadFlow: (flowId) => ipcRenderer.invoke(IPC.FLOW.LOAD, flowId),
  getFlowState: () => ipcRenderer.invoke(IPC.FLOW.GET_STATE),
  setFlowStep: (step) => ipcRenderer.invoke(IPC.FLOW.SET_STEP, step),
  nextFlowStep: () => ipcRenderer.invoke(IPC.FLOW.NEXT_STEP),

  getCompanionStatus: () => ipcRenderer.invoke(IPC.COMPANION.GET_STATUS),
  resetCompanion: () => ipcRenderer.invoke(IPC.COMPANION.RESET),
  onStateChange: (cb) => onEvent(IPC.COMPANION.STATE_CHANGE, cb),
  onFlowStepChanged: (cb) => onEvent(IPC.FLOW.STEP_CHANGED, cb),

  onHotkeyPress: (cb) => onSignal(IPC.HOTKEY.PRESS, cb),
  onHotkeyRelease: (cb) => onSignal(IPC.HOTKEY.RELEASE, cb),

  sendAudioChunk: (wav) => ipcRenderer.send(IPC.AUDIO.CHUNK, wav),
  sendAudioStop: () => ipcRenderer.send(IPC.AUDIO.STOP),

  onTranscriptionResult: (cb) => onEvent(IPC.TRANSCRIPTION.RESULT, cb),

  requestGuidance: (q) => ipcRenderer.invoke(IPC.VISION.REQUEST, q),
  onGuidanceResult: (cb) => onEvent(IPC.VISION.RESULT, cb),

  // TTS: main sends MP3, renderer plays and acks
  onPlayAudio: (cb) => onEvent(IPC.TTS.PLAY_AUDIO, cb),
  notifyAudioDone: () => ipcRenderer.send(IPC.TTS.AUDIO_DONE),

  // TTS: main asks renderer to speak via Web Speech (offline fallback)
  onWebSpeech: (cb) => onEvent(IPC.TTS.WEB_SPEECH, cb),
  notifyWebSpeechDone: () => ipcRenderer.send(IPC.TTS.WEB_SPEECH_DONE),

  overlayShow: () => ipcRenderer.send(IPC.OVERLAY.SHOW),
  overlayHide: () => ipcRenderer.send(IPC.OVERLAY.HIDE),
  overlayPoint: (p) => ipcRenderer.send(IPC.OVERLAY.POINT, p),
  overlaySetText: (t) => ipcRenderer.send(IPC.OVERLAY.SET_TEXT, t),
  onOverlayPoint: (cb) => onEvent(IPC.OVERLAY.POINT, cb),
  onOverlaySetText: (cb) => onEvent(IPC.OVERLAY.SET_TEXT, cb),
  onOverlayHide: (cb) => onSignal(IPC.OVERLAY.HIDE, cb),

  getProfile: () => ipcRenderer.invoke(IPC.CONFIG.GET_PROFILE),
  activateCode: (req) => ipcRenderer.invoke(IPC.CONFIG.ACTIVATE_CODE, req),
  clearProfile: () => ipcRenderer.invoke(IPC.CONFIG.CLEAR_PROFILE),

  showOnboarding: () => ipcRenderer.invoke(IPC.WINDOW.SHOW_ONBOARDING),
  closeOnboarding: () => ipcRenderer.invoke(IPC.WINDOW.CLOSE_ONBOARDING),
  togglePanel: () => ipcRenderer.invoke(IPC.WINDOW.TOGGLE_PANEL),

  logSession: (event) => ipcRenderer.send(IPC.SESSION.LOG, event),
}

contextBridge.exposeInMainWorld('electronAPI', api)

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
