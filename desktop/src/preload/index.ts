/**
 * Preload bridge — exposes a safe, typed API to renderer processes.
 *
 * This is the ONLY file that can import from both electron and the renderer.
 * contextBridge ensures renderers cannot access raw Node.js or Electron APIs.
 *
 * The exposed `window.electronAPI` object is the entire contract between
 * main and renderer. Any new capability added to main MUST be exposed here.
 *
 * Security principle: expose the minimum needed. Each method maps directly
 * to one IPC channel. Renderers cannot construct arbitrary IPC messages.
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
// Type definition for window.electronAPI
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
  onStateChange: (callback: (status: CompanionStatus) => void) => () => void
  onFlowStepChanged: (callback: (context: FlowContext) => void) => () => void

  // Hotkey events
  onHotkeyPress: (callback: () => void) => () => void
  onHotkeyRelease: (callback: () => void) => () => void

  // Audio (renderer captures mic, sends chunks to main)
  sendAudioChunk: (wavBase64: string) => void
  sendAudioStop: () => void

  // Transcription result
  onTranscriptionResult: (callback: (text: string) => void) => () => void

  // Vision / guidance
  requestGuidance: (userQuery: string) => Promise<GuidanceResult>
  onGuidanceResult: (callback: (result: GuidanceResult) => void) => () => void

  // TTS
  speak: (text: string) => Promise<void>
  onTtsDone: (callback: () => void) => () => void

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

  // Session analytics
  logSession: (event: object) => void
}

// ---------------------------------------------------------------------------
// Helper: create an IPC listener that returns an unsubscribe function
// ---------------------------------------------------------------------------

function onEvent<T>(channel: string, callback: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T): void => {
    callback(payload)
  }
  ipcRenderer.on(channel, handler)
  // Return cleanup function so React components can unsubscribe in useEffect
  return () => ipcRenderer.removeListener(channel, handler)
}

// ---------------------------------------------------------------------------
// Expose the API via contextBridge
// ---------------------------------------------------------------------------

const api: ElectronAPI = {
  // Screenshot
  captureScreen: () => ipcRenderer.invoke(IPC.SCREENSHOT.CAPTURE),

  // Flow
  loadFlow: (flowId) => ipcRenderer.invoke(IPC.FLOW.LOAD, flowId),
  getFlowState: () => ipcRenderer.invoke(IPC.FLOW.GET_STATE),
  setFlowStep: (step) => ipcRenderer.invoke(IPC.FLOW.SET_STEP, step),
  nextFlowStep: () => ipcRenderer.invoke(IPC.FLOW.NEXT_STEP),

  // Companion
  getCompanionStatus: () => ipcRenderer.invoke(IPC.COMPANION.GET_STATUS),
  onStateChange: (cb) => onEvent(IPC.COMPANION.STATE_CHANGE, cb),
  onFlowStepChanged: (cb) => onEvent(IPC.FLOW.STEP_CHANGED, cb),

  // Hotkey events
  onHotkeyPress: (cb) => onEvent(IPC.HOTKEY.PRESS, cb),
  onHotkeyRelease: (cb) => onEvent(IPC.HOTKEY.RELEASE, cb),

  // Audio
  sendAudioChunk: (wavBase64) => ipcRenderer.send(IPC.AUDIO.CHUNK, wavBase64),
  sendAudioStop: () => ipcRenderer.send(IPC.AUDIO.STOP),

  // Transcription
  onTranscriptionResult: (cb) => onEvent(IPC.TRANSCRIPTION.RESULT, cb),

  // Vision / guidance
  requestGuidance: (userQuery) => ipcRenderer.invoke(IPC.VISION.REQUEST, userQuery),
  onGuidanceResult: (cb) => onEvent(IPC.VISION.RESULT, cb),

  // TTS
  speak: (text) => ipcRenderer.invoke(IPC.TTS.SPEAK, text),
  onTtsDone: (cb) => onEvent(IPC.TTS.DONE, cb),

  // Overlay
  overlayShow: () => ipcRenderer.send(IPC.OVERLAY.SHOW),
  overlayHide: () => ipcRenderer.send(IPC.OVERLAY.HIDE),
  overlayPoint: (point) => ipcRenderer.send(IPC.OVERLAY.POINT, point),
  overlaySetText: (text) => ipcRenderer.send(IPC.OVERLAY.SET_TEXT, text),
  onOverlayPoint: (cb) => onEvent(IPC.OVERLAY.POINT, cb),
  onOverlaySetText: (cb) => onEvent(IPC.OVERLAY.SET_TEXT, cb),
  onOverlayHide: (cb) => onEvent(IPC.OVERLAY.HIDE, cb),

  // Config
  getProfile: () => ipcRenderer.invoke(IPC.CONFIG.GET_PROFILE),
  activateCode: (request) => ipcRenderer.invoke(IPC.CONFIG.ACTIVATE_CODE, request),
  clearProfile: () => ipcRenderer.invoke(IPC.CONFIG.CLEAR_PROFILE),

  // Window management
  showOnboarding: () => ipcRenderer.invoke(IPC.WINDOW.SHOW_ONBOARDING),
  closeOnboarding: () => ipcRenderer.invoke(IPC.WINDOW.CLOSE_ONBOARDING),
  togglePanel: () => ipcRenderer.invoke(IPC.WINDOW.TOGGLE_PANEL),

  // Session analytics (fire-and-forget)
  logSession: (event) => ipcRenderer.send(IPC.SESSION.LOG, event)
}

contextBridge.exposeInMainWorld('electronAPI', api)

// ---------------------------------------------------------------------------
// TypeScript declaration merging for renderer code
// ---------------------------------------------------------------------------
// This file is also referenced by tsconfig.web.json so renderers get
// full type safety on window.electronAPI without any additional imports.
declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
