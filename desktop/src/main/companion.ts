/**
 * CompanionManager — central state machine.
 *
 * States: idle → listening → processing → responding → idle
 *
 * Pipeline (mirrors clicky's two-stage parallel approach):
 *   1. Capture screenshot (logical-px for GLM + CU-resolution for Computer Use)
 *   2a. streamGuidance()  — streams text to panel + overlay bubble near cursor
 *   2b. detectElementLocation() — parallel Computer Use API call for coordinates
 *   3. TTS plays + awaits detection result
 *   4. Overlay cursor animates to detected point (CU preferred, POINT tag fallback)
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

  /** Release signals the renderer to stop recording — pipeline runs via onManualQuery */
  onRelease(): void {
    if (this.state !== 'listening') return
    this.setState('idle')
    this.broadcast(IPC.HOTKEY_RELEASE)
  }

  // ---------------------------------------------------------------------------
  // Manual text / voice transcript query
  // ---------------------------------------------------------------------------

  onManualQuery(text: string): void {
    // Accept 'idle' AND 'listening' (transcript can arrive before key is released)
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

    // 1. Screenshot — returns both full-res (for GLM) and CU-res (for Computer Use)
    const {
      base64: screenshot,
      base64Cu,
      width: screenWidth,
      height: screenHeight,
      cuWidth,
      cuHeight,
      cursorLocalX,
      cursorLocalY,
      displayBounds,
    } = await captureScreen()

    // 2b. Start element detection immediately (runs in background while text streams)
    //     Uses Claude Computer Use API — far more accurate than vision-model POINT tags.
    //     Falls back to null if ANTHROPIC_API_KEY is not configured in the proxy.
    const detectionPromise = this.detectElementLocation(
      base64Cu, question, displayBounds, cuWidth, cuHeight,
    ).catch(() => null)

    // 2a. Stream text response to panel + floating overlay bubble near cursor
    this.responseText = ''
    const { personality } = getOrbConfig()
    let firstChunk = true

    const { text, point: fallbackPoint } = await streamGuidance({
      screenshotBase64: screenshot,
      transcript:       question,
      history:          this.history,
      proxyUrl:         proxy,
      screenWidth,      screenHeight,
      personality,
      onChunk: (chunk) => {
        this.responseText += chunk

        // Send chunk to chat panel
        if (!this.panelWindow.isDestroyed()) {
          this.panelWindow.webContents.send(IPC.CLAUDE_CHUNK, chunk)
        }

        // On first chunk: show overlay + position stream bubble at cursor
        if (!this.overlayWindow.isDestroyed()) {
          if (firstChunk) {
            firstChunk = false
            this.overlayWindow.setBounds(displayBounds)
            this.overlayWindow.showInactive()  // show without stealing focus
            this.overlayWindow.webContents.send(IPC.OVERLAY_RESPONSE_START, {
              x: cursorLocalX,
              y: cursorLocalY,
            })
          }
          this.overlayWindow.webContents.send(IPC.OVERLAY_RESPONSE_CHUNK, chunk)
        }
      },
    })

    // 3. Update conversation history (strip POINT tags before storing)
    this.history.push(
      { role: 'user',      content: question },
      { role: 'assistant', content: text },
    )
    if (this.history.length > MAX_HISTORY * 2) {
      this.history = this.history.slice(-MAX_HISTORY * 2)
    }

    // Signal panel and overlay that streaming is complete
    if (!this.panelWindow.isDestroyed())  this.panelWindow.webContents.send(IPC.CLAUDE_DONE)
    if (!this.overlayWindow.isDestroyed()) this.overlayWindow.webContents.send(IPC.OVERLAY_RESPONSE_DONE)

    // 4. TTS + await detection result in parallel
    //    Detection started before streaming began, so it's usually ready by now.
    this.setState('responding')
    const [, detectedPoint] = await Promise.all([
      speak(text, proxy),
      detectionPromise,
    ])

    // 5. Show overlay cursor — prefer Computer Use result; fallback to POINT tag
    const point = detectedPoint ?? fallbackPoint
    if (point) this.showOverlayPoint(point, displayBounds)

    // 6. Done
    this.setState('idle')
    setTimeout(() => this.hideOverlay(), 8_000)
  }

  // ---------------------------------------------------------------------------
  // Element location detection via Claude Computer Use API
  // ---------------------------------------------------------------------------

  private async detectElementLocation(
    screenshotBase64Cu: string,
    question:           string,
    displayBounds:      Electron.Rectangle,
    cuWidth:            number,
    cuHeight:           number,
  ): Promise<PointTarget | null> {
    const proxy = getProxyUrl()
    const res = await fetch(`${proxy}/detect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        screenshotBase64: screenshotBase64Cu,
        userQuestion:     question,
        displayWidth:     displayBounds.width,
        displayHeight:    displayBounds.height,
        cuWidth,
        cuHeight,
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as { x: number | null; y: number | null }
    if (data.x == null || data.y == null) return null
    console.info(`[companion] Computer Use detected: (${data.x}, ${data.y})`)
    return { x: data.x, y: data.y, label: '', screenIndex: 0 }
  }

  // ---------------------------------------------------------------------------
  // Overlay helpers
  // ---------------------------------------------------------------------------

  private showOverlayPoint(point: PointTarget, displayBounds: Electron.Rectangle): void {
    if (this.overlayWindow.isDestroyed()) return
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
