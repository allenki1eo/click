/**
 * CompanionManager — central state machine.
 *
 * States: idle → listening → processing → responding → idle
 *
 * Two ways to trigger a query:
 *  1. PTT (push-to-talk): records audio, transcribes, sends screenshot + text
 *  2. Manual text (onManualQuery): skips audio, uses typed text directly
 *
 * Conversation history: last 10 turns kept in memory.
 */

import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import type { CompanionState, CompanionStatus, Message, PointTarget } from '../shared/types'
import { captureScreen } from './screenshot'
import { streamGuidance } from '../services/claude'
import { speak, setTtsWindow } from '../services/tts'
import { transcribeAudio } from '../services/transcription'
import { getProxyUrl, getOrbConfig } from './config'

const MAX_HISTORY = 10

export class CompanionManager {
  private state: CompanionState = 'idle'
  private responseText = ''
  private transcript = ''
  private error = ''
  private history: Message[] = []
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

  onAudioChunk(base64: string): void {
    if (this.state !== 'listening') return
    this.audioChunks.push(Buffer.from(base64, 'base64'))
  }

  // ---------------------------------------------------------------------------
  // Manual text query (typed in the panel UI)
  // ---------------------------------------------------------------------------

  onManualQuery(text: string): void {
    if (this.state !== 'idle') return
    const q = text.trim()
    if (!q) return
    this.transcript = q
    this.responseText = ''
    this.error = ''
    this.setState('processing')
    this.broadcast(IPC.HOTKEY_RELEASE)  // tell UI we're past listening state
    this.runPipeline(q).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[companion] manual query error:', msg)
      this.error = msg
      this.setState('idle')
    })
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
  // Core pipeline
  // ---------------------------------------------------------------------------

  /**
   * @param manualTranscript  When provided, skip audio capture and use this text.
   */
  private async runPipeline(manualTranscript?: string): Promise<void> {
    const proxy = getProxyUrl()

    // 1. Transcribe audio (only for voice mode, not manual text)
    if (!manualTranscript) {
      if (this.audioChunks.length > 0) {
        const wav = Buffer.concat(this.audioChunks)
        this.audioChunks = []
        this.transcript = await transcribeAudio(wav, proxy)
        console.info('[companion] transcript:', this.transcript)
      }
    }

    // 2. Screenshot (returns base64 + logical pixel dimensions)
    const { base64: screenshot, width: screenWidth, height: screenHeight } = await captureScreen()

    // 3. Stream AI response
    this.responseText = ''
    const { personality } = getOrbConfig()
    const { text, point } = await streamGuidance({
      screenshotBase64: screenshot,
      transcript: manualTranscript ?? this.transcript,
      history: this.history,
      proxyUrl: proxy,
      screenWidth,
      screenHeight,
      personality,
      onChunk: (chunk) => {
        this.responseText += chunk
        if (!this.panelWindow.isDestroyed()) {
          this.panelWindow.webContents.send(IPC.CLAUDE_CHUNK, chunk)
        }
      },
    })

    // 4. Update conversation history
    this.history.push(
      { role: 'user',      content: manualTranscript ?? this.transcript ?? '(screenshot only)' },
      { role: 'assistant', content: text },
    )
    if (this.history.length > MAX_HISTORY * 2) {
      this.history = this.history.slice(-MAX_HISTORY * 2)
    }

    this.panelWindow.webContents.send(IPC.CLAUDE_DONE)

    // 5. Show overlay cursor if AI pointed at something
    if (point) this.showOverlayPoint(point)

    // 6. TTS
    this.setState('responding')
    await speak(text, proxy)

    // 7. Done
    this.setState('idle')
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
    return { state: this.state, responseText: this.responseText, transcript: this.transcript, error: this.error }
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
  // IPC
  // ---------------------------------------------------------------------------

  private registerIpc(): void {
    ipcMain.handle(IPC.GET_STATUS,    () => this.getStatus())
    ipcMain.handle(IPC.RESET,         () => this.reset())
    ipcMain.handle(IPC.MANUAL_QUERY,  (_, text: string) => this.onManualQuery(text))
    ipcMain.on(IPC.AUDIO_CHUNK, (_, base64: string) => this.onAudioChunk(base64))
    ipcMain.on(IPC.AUDIO_STOP,  () => { /* audio stop acknowledged */ })
  }
}
