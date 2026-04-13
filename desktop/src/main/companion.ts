/**
 * CompanionManager — central state machine.
 *
 * States: idle → listening → processing → responding → idle
 *
 * Voice path (new):
 *   onPress() sets state=listening; the renderer uses the Web Speech API to
 *   get a transcript, then calls submitQuery() — exactly like typed text.
 *   onRelease() therefore only broadcasts HOTKEY_RELEASE so the renderer
 *   knows to stop its speech recognition; no pipeline runs here.
 *
 * Text path: onManualQuery() — accepts typed text OR Web-Speech transcript.
 *
 * Conversation history: last 10 turns kept in memory.
 */

import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import type { CompanionState, CompanionStatus, Message, PointTarget } from '../shared/types'
import { captureScreen } from './screenshot'
import { streamGuidance } from '../services/claude'
import { speak, setTtsWindow } from '../services/tts'
import { getProxyUrl, getOrbConfig } from './config'

const MAX_HISTORY = 10

export class CompanionManager {
  private state: CompanionState = 'idle'
  private responseText = ''
  private transcript = ''
  private error = ''
  private history: Message[] = []

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
    this.transcript = ''
    this.responseText = ''
    this.error = ''
    this.setState('listening')
    this.broadcast(IPC.HOTKEY_PRESS)
  }

  /** Release just signals the renderer to stop Web Speech — pipeline runs via onManualQuery */
  onRelease(): void {
    if (this.state !== 'listening') return
    this.setState('idle')
    this.broadcast(IPC.HOTKEY_RELEASE)
  }

  // ---------------------------------------------------------------------------
  // Manual text / Web-Speech transcript query
  // ---------------------------------------------------------------------------

  onManualQuery(text: string): void {
    // Accept 'idle' AND 'listening' (Web-Speech can finish before key is released)
    if (this.state !== 'idle' && this.state !== 'listening') return
    const q = text.trim()
    if (!q) return
    this.transcript = q
    this.responseText = ''
    this.error = ''
    this.setState('processing')
    this.runPipeline(q).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[companion] pipeline error:', msg)
      this.error = msg
      this.setState('idle')
    })
  }

  reset(): void {
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

  private async runPipeline(question: string): Promise<void> {
    const proxy = getProxyUrl()

    // 1. Screenshot (returns base64 + logical pixel dimensions + display bounds)
    const { base64: screenshot, width: screenWidth, height: screenHeight, displayBounds } = await captureScreen()

    // 2. Stream AI response
    this.responseText = ''
    const { personality } = getOrbConfig()
    const { text, point } = await streamGuidance({
      screenshotBase64: screenshot,
      transcript:       question,
      history:          this.history,
      proxyUrl:         proxy,
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

    // 3. Update conversation history
    this.history.push(
      { role: 'user',      content: question },
      { role: 'assistant', content: text },
    )
    if (this.history.length > MAX_HISTORY * 2) {
      this.history = this.history.slice(-MAX_HISTORY * 2)
    }

    this.panelWindow.webContents.send(IPC.CLAUDE_DONE)

    // 4. Show overlay cursor on the correct display
    if (point) this.showOverlayPoint(point, displayBounds)

    // 5. TTS
    this.setState('responding')
    await speak(text, proxy)

    // 6. Done
    this.setState('idle')
    setTimeout(() => this.hideOverlay(), 8_000)
  }

  // ---------------------------------------------------------------------------
  // Overlay helpers
  // ---------------------------------------------------------------------------

  private showOverlayPoint(point: PointTarget, displayBounds: Electron.Rectangle): void {
    if (this.overlayWindow.isDestroyed()) return
    // Reposition overlay to the display that was captured
    this.overlayWindow.setBounds(displayBounds)
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
    ipcMain.handle(IPC.GET_STATUS,   () => this.getStatus())
    ipcMain.handle(IPC.RESET,        () => this.reset())
    ipcMain.handle(IPC.MANUAL_QUERY, (_, text: string) => this.onManualQuery(text))
  }
}
