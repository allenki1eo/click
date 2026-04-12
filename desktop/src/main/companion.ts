/**
 * CompanionManager — central state machine, mirrors CompanionManager.swift.
 *
 * States:
 *   idle       → user presses PTT  → listening
 *   listening  → user releases PTT → processing
 *   processing → Claude done       → responding
 *   responding → TTS done          → idle
 *
 * Conversation history: last 10 turns kept in memory (same as clicky).
 */

import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import type { CompanionState, CompanionStatus, Message, PointTarget } from '../shared/types'
import { captureScreen } from './screenshot'
import { streamGuidance } from '../services/claude'
import { speak, setTtsWindow } from '../services/tts'
import { transcribeAudio } from '../services/transcription'
import { getProxyUrl } from './config'

const MAX_HISTORY = 10 // keep last 10 turns, same as clicky

export class CompanionManager {
  private state: CompanionState = 'idle'
  private responseText = ''
  private transcript = ''
  private error = ''

  /** Conversation history — sent with every Claude request */
  private history: Message[] = []

  /** Audio chunks collected while PTT is held */
  private audioChunks: Buffer[] = []

  constructor(
    private readonly panelWindow: BrowserWindow,
    private readonly overlayWindow: BrowserWindow,
  ) {
    setTtsWindow(panelWindow)
    this.registerIpc()
  }

  // ---------------------------------------------------------------------------
  // PTT events (called by HotkeyManager)
  // ---------------------------------------------------------------------------

  onPress(): void {
    if (this.state !== 'idle') return
    this.audioChunks = []
    this.transcript = ''
    this.responseText = ''
    this.error = ''
    this.setState('listening')
    this.broadcast(IPC.HOTKEY_PRESS)
  }

  onRelease(): void {
    if (this.state !== 'listening') return
    this.setState('processing')
    this.broadcast(IPC.HOTKEY_RELEASE)

    this.runPipeline().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[companion] pipeline error:', msg)
      this.error = msg
      this.setState('idle')
    })
  }

  /** Called by audio IPC handler when renderer sends a chunk */
  onAudioChunk(base64: string): void {
    if (this.state !== 'listening') return
    this.audioChunks.push(Buffer.from(base64, 'base64'))
  }

  reset(): void {
    this.audioChunks = []
    this.history = []
    this.responseText = ''
    this.transcript = ''
    this.error = ''
    this.setState('idle')
    this.hideOverlay()
  }

  // ---------------------------------------------------------------------------
  // Core pipeline — transcribe → screenshot → Claude stream → TTS → overlay
  // ---------------------------------------------------------------------------

  private async runPipeline(): Promise<void> {
    const proxy = getProxyUrl()

    // 1. Transcribe audio (non-fatal if it fails)
    if (this.audioChunks.length > 0) {
      const wav = Buffer.concat(this.audioChunks)
      this.audioChunks = []
      this.transcript = await transcribeAudio(wav, proxy)
      console.info('[companion] transcript:', this.transcript)
    }

    // 2. Screenshot
    const screenshot = await captureScreen()

    // 3. Stream Claude response — each chunk goes to the panel UI in real-time
    this.responseText = ''
    const { text, point } = await streamGuidance({
      screenshotBase64: screenshot,
      transcript: this.transcript,
      history: this.history,
      proxyUrl: proxy,
      onChunk: (chunk) => {
        this.responseText += chunk
        // Send each chunk to renderer so text types in progressively
        if (!this.panelWindow.isDestroyed()) {
          this.panelWindow.webContents.send(IPC.CLAUDE_CHUNK, chunk)
        }
      },
    })

    // 4. Update conversation history (cap at MAX_HISTORY turns)
    this.history.push(
      { role: 'user', content: this.transcript || '(screenshot only)' },
      { role: 'assistant', content: text },
    )
    if (this.history.length > MAX_HISTORY * 2) {
      this.history = this.history.slice(-MAX_HISTORY * 2)
    }

    this.panelWindow.webContents.send(IPC.CLAUDE_DONE)

    // 5. Show overlay cursor if Claude pointed at something
    if (point) this.showOverlayPoint(point)

    // 6. TTS
    this.setState('responding')
    await speak(text, proxy)

    // 7. Done — back to idle
    this.setState('idle')

    // Auto-hide overlay after 8 seconds
    setTimeout(() => this.hideOverlay(), 8_000)
  }

  // ---------------------------------------------------------------------------
  // Overlay helpers
  // ---------------------------------------------------------------------------

  private showOverlayPoint(point: PointTarget): void {
    if (this.overlayWindow.isDestroyed()) return
    this.overlayWindow.webContents.send(IPC.OVERLAY_POINT, point)
    this.overlayWindow.webContents.send(IPC.OVERLAY_TEXT, this.responseText)
    this.overlayWindow.show()
  }

  private hideOverlay(): void {
    if (this.overlayWindow.isDestroyed()) return
    this.overlayWindow.webContents.send(IPC.OVERLAY_HIDE)
    this.overlayWindow.hide()
  }

  // ---------------------------------------------------------------------------
  // State machine
  // ---------------------------------------------------------------------------

  private setState(s: CompanionState): void {
    console.info(`[companion] ${this.state} → ${s}`)
    this.state = s
    this.broadcastStatus()
  }

  getStatus(): CompanionStatus {
    return {
      state: this.state,
      responseText: this.responseText,
      transcript: this.transcript,
      error: this.error,
    }
  }

  private broadcastStatus(): void {
    const status = this.getStatus()
    for (const win of [this.panelWindow, this.overlayWindow]) {
      if (!win.isDestroyed()) win.webContents.send(IPC.STATUS, status)
    }
  }

  private broadcast(channel: string): void {
    for (const win of [this.panelWindow, this.overlayWindow]) {
      if (!win.isDestroyed()) win.webContents.send(channel)
    }
  }

  // ---------------------------------------------------------------------------
  // IPC handlers
  // ---------------------------------------------------------------------------

  private registerIpc(): void {
    ipcMain.handle(IPC.GET_STATUS, () => this.getStatus())
    ipcMain.handle(IPC.RESET, () => this.reset())
    ipcMain.on(IPC.AUDIO_CHUNK, (_, base64: string) => this.onAudioChunk(base64))
    ipcMain.on(IPC.AUDIO_STOP, () => { /* audio stop acknowledged */ })
  }
}
