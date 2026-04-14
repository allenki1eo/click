/**
 * Preload bridge — exposes a minimal, typed API to renderers via contextBridge.
 * Renderers never access ipcRenderer directly.
 */

import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { CompanionStatus, Message, OrbConfig, PointTarget } from '../shared/types'

function on<T>(ch: string, cb: (v: T) => void): () => void {
  const h = (_: Electron.IpcRendererEvent, v: T): void => cb(v)
  ipcRenderer.on(ch, h)
  return () => ipcRenderer.removeListener(ch, h)
}

function once(ch: string, cb: () => void): () => void {
  const h = (): void => cb()
  ipcRenderer.on(ch, h)
  return () => ipcRenderer.removeListener(ch, h)
}

const api = {
  // Status
  getStatus:    (): Promise<CompanionStatus> => ipcRenderer.invoke(IPC.GET_STATUS),
  onStatus:     (cb: (s: CompanionStatus) => void) => on(IPC.STATUS, cb),
  reset:        (): Promise<void> => ipcRenderer.invoke(IPC.RESET),

  // Hotkey
  onHotkeyPress:   (cb: () => void) => once(IPC.HOTKEY_PRESS, cb),
  onHotkeyRelease: (cb: () => void) => once(IPC.HOTKEY_RELEASE, cb),

  // Audio (renderer captures mic, sends to main)
  sendAudioChunk:  (b64: string): void => ipcRenderer.send(IPC.AUDIO_CHUNK, b64),
  sendAudioStop:   (): void => ipcRenderer.send(IPC.AUDIO_STOP),

  // Claude streaming
  onClaudeChunk:  (cb: (chunk: string) => void) => on(IPC.CLAUDE_CHUNK, cb),
  onClaudeDone:   (cb: () => void) => once(IPC.CLAUDE_DONE, cb),

  // TTS
  onTtsPlay:          (cb: (b64: string) => void) => on(IPC.TTS_PLAY, cb),
  notifyTtsDone:      (): void => ipcRenderer.send(IPC.TTS_DONE),
  onWebSpeech:        (cb: (text: string) => void) => on(IPC.TTS_WEB_SPEECH, cb),
  notifyWebSpeechDone:(): void => ipcRenderer.send(IPC.TTS_WEB_SPEECH_DONE),

  // Overlay — cursor pointing
  onOverlayPoint: (cb: (p: PointTarget) => void) => on(IPC.OVERLAY_POINT, cb),
  onOverlayText:  (cb: (t: string) => void) => on(IPC.OVERLAY_TEXT, cb),
  onOverlayHide:  (cb: () => void) => once(IPC.OVERLAY_HIDE, cb),

  // Overlay — streaming response bubble near cursor (clicky-style)
  onOverlayResponseStart: (cb: (pos: { x: number; y: number }) => void) => on<{ x: number; y: number }>(IPC.OVERLAY_RESPONSE_START, cb),
  onOverlayResponseChunk: (cb: (chunk: string) => void) => on<string>(IPC.OVERLAY_RESPONSE_CHUNK, cb),
  onOverlayResponseDone:  (cb: () => void) => once(IPC.OVERLAY_RESPONSE_DONE, cb),

  // Manual text query from the panel input field
  submitQuery: (text: string): Promise<void> => ipcRenderer.invoke(IPC.MANUAL_QUERY, text),

  // Orb
  onCursorMove: (cb: (d: unknown) => void) => on(IPC.CURSOR_MOVE, cb),
  orbClick:     (): void => ipcRenderer.send(IPC.ORB_CLICK),

  // Orb customisation
  getOrbConfig: (): Promise<OrbConfig> => ipcRenderer.invoke(IPC.GET_ORB_CONFIG),
  setOrbConfig: (cfg: Partial<OrbConfig>): Promise<void> => ipcRenderer.invoke(IPC.SET_ORB_CONFIG, cfg),
  onOrbConfig:  (cb: (cfg: OrbConfig) => void) => on<OrbConfig>(IPC.ORB_CONFIG, cb),

  // Proxy URL
  getProxyUrl: (): Promise<string> => ipcRenderer.invoke(IPC.GET_PROXY_URL),
  setProxyUrl: (url: string): Promise<void> => ipcRenderer.invoke(IPC.SET_PROXY_URL, url),

  // Voice transcription — renderer sends base64 audio; main calls proxy /transcribe
  transcribeAudio: (b64: string): Promise<string> => ipcRenderer.invoke(IPC.TRANSCRIBE_AUDIO, b64),

  // Persistent conversation history
  getHistory: (): Promise<Message[]> => ipcRenderer.invoke(IPC.HISTORY_GET),
}

contextBridge.exposeInMainWorld('api', api)

declare global {
  interface Window { api: typeof api }
}
