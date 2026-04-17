/**
 * CompanionManager — central state machine.
 *
 * States: idle → listening → processing → responding → idle
 *
 * Pipeline:
 *   1. captureScreen() + getActiveAppContext() run in parallel
 *   2a. streamGuidance()  — streams text to panel + overlay bubble near cursor
 *       Includes app context (Feature 1) + OCR instruction (Feature 2)
 *   2b. detectElementLocation() — parallel Computer Use API call for coordinates
 *   3. TTS plays + awaits detection result
 *   4. Overlay cursor animates to detected point(s):
 *      - Single step: CU preferred, POINT tag fallback
 *      - Multi-step:  STEP tags shown sequentially with 3.5 s between each
 *        (Feature 3)
 *
 * Conversation history: last 10 turns kept in memory.
 */

import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import type { CompanionState, CompanionStatus, HistoryEntry, Message, PointTarget } from '../shared/types'
import { captureScreen } from './screenshot'
import { getActiveAppContext, formatAppContext } from './appContext'
import { streamGuidance } from '../services/claude'
import { speak, setTtsWindow } from '../services/tts'
import { getProxyUrl, getOrbConfig } from './config'
import { loadHistory, appendHistory } from './history'

const MAX_HISTORY = 10
/** Delay between multi-step overlay targets (ms) */
const STEP_DWELL_MS = 3500

function uid(): string { return Math.random().toString(36).slice(2, 10) }

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

    // Restore AI context from persisted history so multi-turn conversation
    // continues seamlessly after app restarts.
    const saved = loadHistory()
    if (saved.length) {
      this.history = saved
        .slice(-MAX_HISTORY * 2)
        .map((e) => ({ role: e.role, content: e.content }))
      console.info(`[companion] Loaded ${saved.length} history entries (${this.history.length} in context)`)
    }
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
    this.history = []   // clear in-memory AI context (disk cleared by CLEAR_HISTORY IPC)
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

    // 1. Screenshot + active-app context in parallel (Feature 1)
    const [screenshotData, appContext] = await Promise.all([
      captureScreen(),
      getActiveAppContext(),
    ])

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
    } = screenshotData

    if (appContext.appName !== 'Unknown') {
      console.info(`[companion] Active app: ${appContext.appName} — "${appContext.windowTitle}"`)
    }

    // 2b. Start element detection immediately (runs in background while text streams)
    //     Uses Claude Computer Use API — more accurate than vision-model POINT tags.
    //     Falls back to null if ANTHROPIC_API_KEY is not configured in the proxy.
    const appContextStr = formatAppContext(appContext)
    const detectionPromise = this.detectElementLocation(
      base64Cu, question, displayBounds, cuWidth, cuHeight, appContextStr || undefined,
    ).catch(() => null)

    // 2a. Stream text response to panel + floating overlay bubble near cursor
    this.responseText = ''
    const { personality } = getOrbConfig()
    let firstChunk = true

    const { text, point: fallbackPoint, steps: glmSteps } = await streamGuidance({
      screenshotBase64: screenshot,
      transcript:       question,
      history:          this.history,
      proxyUrl:         proxy,
      screenWidth,      screenHeight,
      personality,
      appContext,                            // Feature 1: active app context
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
            this.overlayWindow.showInactive()
            this.overlayWindow.webContents.send(IPC.OVERLAY_RESPONSE_START, {
              x: cursorLocalX,
              y: cursorLocalY,
            })
          }
          this.overlayWindow.webContents.send(IPC.OVERLAY_RESPONSE_CHUNK, chunk)
        }
      },
    })

    // 3. Update conversation history (POINT/STEP tags already stripped by parsePointTag)
    this.history.push(
      { role: 'user',      content: question },
      { role: 'assistant', content: text },
    )
    if (this.history.length > MAX_HISTORY * 2) {
      this.history = this.history.slice(-MAX_HISTORY * 2)
    }

    // Persist this turn to disk — survives app restarts
    const now = Date.now()
    appendHistory([
      { id: uid(), role: 'user',      content: question, ts: now },
      { id: uid(), role: 'assistant', content: text,     ts: now + 1 },
    ])

    // Signal panel and overlay that streaming is complete
    if (!this.panelWindow.isDestroyed())   this.panelWindow.webContents.send(IPC.CLAUDE_DONE)
    if (!this.overlayWindow.isDestroyed()) this.overlayWindow.webContents.send(IPC.OVERLAY_RESPONSE_DONE)

    // 4. TTS + await detection result in parallel
    this.setState('responding')
    const [, detectedPoint] = await Promise.all([
      speak(text, proxy),
      detectionPromise,
    ])

    // 5. Decide which points to show
    //
    //    Multi-step (Feature 3): if GLM returned ≥2 STEP tags, show them all
    //    in sequence.  CU detection is still used for step 1 (highest accuracy).
    //
    //    Single step: prefer CU result; fallback to GLM POINT tag.
    if (glmSteps.length >= 2) {
      // Inject CU coordinate into step 1 if detection succeeded
      const steps = glmSteps.map((s, i) =>
        i === 0 && detectedPoint ? { ...s, x: detectedPoint.x, y: detectedPoint.y } : s
      )
      await this.showOverlaySteps(steps, displayBounds)
    } else {
      const point = detectedPoint ?? fallbackPoint
      if (point) this.showOverlayPoint(point, displayBounds)
    }

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
    appContextStr?:     string,
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
        appContext:       appContextStr,
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

  /**
   * Multi-step overlay (Feature 3) — animate cursor to each step target in
   * order, showing a "Step N / Total" badge.  Waits STEP_DWELL_MS between
   * each so the user has time to read the label before the next step fires.
   */
  private async showOverlaySteps(
    steps:         PointTarget[],
    displayBounds: Electron.Rectangle,
  ): Promise<void> {
    if (this.overlayWindow.isDestroyed() || !steps.length) return

    this.overlayWindow.setBounds(displayBounds)
    this.overlayWindow.show()

    // Stamp stepTotal onto every item (GLM already sets it but CU-merged step won't have it)
    const total = steps.length
    const stamped = steps.map((s, i) => ({ ...s, stepIndex: i + 1, stepTotal: total }))

    for (const step of stamped) {
      if (this.overlayWindow.isDestroyed()) break
      this.overlayWindow.webContents.send(IPC.OVERLAY_POINT, step)
      this.overlayWindow.webContents.send(IPC.OVERLAY_TEXT, step.label)
      console.info(`[companion] Multi-step ${step.stepIndex}/${step.stepTotal}: "${step.label}" → (${step.x}, ${step.y})`)
      await new Promise<void>((r) => setTimeout(r, STEP_DWELL_MS))
    }
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
