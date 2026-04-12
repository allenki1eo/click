/**
 * CompanionManager — central state machine for the AI companion.
 *
 * Ported from CompanionManager.swift (Clicky).
 *
 * State transitions:
 *   idle ──(hotkeyPress)──► listening
 *   listening ──(hotkeyRelease)──► transcribing
 *   transcribing ──(done)──► processing
 *   processing ──(guidanceReady)──► speaking
 *   speaking ──(ttsDone)──► idle
 *   * ──(error)──► error
 *   error ──(reset)──► idle
 */

import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  CompanionState,
  CompanionStatus,
  GuidanceResult,
  FlowContext
} from '../shared/types'
import type { ConfigManager } from './config'
import { captureScreenshot } from './screenshot'
import { FlowService } from '../services/flows'
import { getGuidance } from '../services/vision'
import { speak, setTtsPanelWindow } from '../services/tts/kokoro'

interface CompanionManagerOptions {
  panelWindow: BrowserWindow
  overlayWindow: BrowserWindow
  configManager: ConfigManager
}

export class CompanionManager {
  private state: CompanionState = 'idle'
  private lastErrorMessage = ''
  private readonly panelWindow: BrowserWindow
  private readonly overlayWindow: BrowserWindow
  private readonly configManager: ConfigManager
  private readonly flowService: FlowService

  /** Accumulated audio chunks from the renderer while push-to-talk is held */
  private pendingAudioChunks: Buffer[] = []

  constructor(options: CompanionManagerOptions) {
    this.panelWindow = options.panelWindow
    this.overlayWindow = options.overlayWindow
    this.configManager = options.configManager
    this.flowService = new FlowService()

    // Give the TTS service a reference to the panel window for audio playback
    setTtsPanelWindow(options.panelWindow)
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  onHotkeyPress(): void {
    if (this.state !== 'idle') return
    this.pendingAudioChunks = []
    this.transitionTo('listening')
    this.broadcast(IPC.HOTKEY.PRESS)
  }

  onHotkeyRelease(): void {
    if (this.state !== 'listening') return
    this.transitionTo('transcribing')
    this.broadcast(IPC.HOTKEY.RELEASE)

    this.runProcessingPipeline().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[CompanionManager] pipeline error:', msg)
      this.transitionToError(msg)
    })
  }

  onAudioChunk(wavBase64: string): void {
    if (this.state !== 'listening') return
    this.pendingAudioChunks.push(Buffer.from(wavBase64, 'base64'))
  }

  reset(): void {
    this.lastErrorMessage = ''
    this.pendingAudioChunks = []
    this.transitionTo('idle')
    // Also hide any lingering overlay
    if (!this.overlayWindow.isDestroyed()) {
      this.overlayWindow.webContents.send(IPC.OVERLAY.HIDE)
      this.overlayWindow.hide()
    }
  }

  getStatus(): CompanionStatus {
    const profile = this.configManager.getStoredProfile()
    const language = profile?.language ?? 'sw'
    const flowContext = this.flowService.getCurrentContext(language)

    return {
      state: this.state,
      label: this.getLabelEn(this.state),
      label_sw: this.getLabelSw(this.state),
      activeFlowId: flowContext?.flowId,
      activeFlowStep: flowContext?.currentStep,
      errorMessage: this.lastErrorMessage || undefined,
    }
  }

  // ---------------------------------------------------------------------------
  // IPC handler registration
  // ---------------------------------------------------------------------------

  registerIpcHandlers(): void {
    ipcMain.handle(IPC.COMPANION.GET_STATUS, () => this.getStatus())

    // Panel reset button calls this
    ipcMain.handle(IPC.COMPANION.RESET, () => this.reset())

    ipcMain.handle(IPC.VISION.REQUEST, async (_, userQuery: string) => {
      return await this.performVisionGuidance(userQuery)
    })
  }

  // ---------------------------------------------------------------------------
  // Core pipeline: transcribe → vision → TTS → overlay
  // ---------------------------------------------------------------------------

  private async runProcessingPipeline(): Promise<void> {
    const profile = this.configManager.getStoredProfile()
    const language = profile?.language ?? 'sw'

    // Step 1: Transcribe audio (if captured)
    let userQuery = ''
    if (this.pendingAudioChunks.length > 0) {
      const combinedBuffer = Buffer.concat(this.pendingAudioChunks)
      this.pendingAudioChunks = []

      try {
        const { transcribeAudio } = await import('../services/transcription/whisper')
        userQuery = await transcribeAudio(combinedBuffer)
        this.broadcast(IPC.TRANSCRIPTION.RESULT, userQuery)
      } catch (err) {
        // Transcription failure is non-fatal — continue with empty query
        console.warn('[CompanionManager] Transcription failed, proceeding without text:', err)
      }
    }

    // Step 2: Vision guidance
    this.transitionTo('processing')
    const guidanceResult = await this.performVisionGuidance(userQuery)

    // Step 3: Show on overlay
    if (!this.overlayWindow.isDestroyed()) {
      this.overlayWindow.webContents.send(IPC.OVERLAY.SET_TEXT, guidanceResult.text)
      this.overlayWindow.webContents.send(IPC.OVERLAY.SHOW)
      this.overlayWindow.show()

      if (guidanceResult.points.length > 0) {
        this.overlayWindow.webContents.send(IPC.OVERLAY.POINT, guidanceResult.points[0])
      }
    }

    // Step 4: Push to panel
    this.broadcast(IPC.VISION.RESULT, guidanceResult)

    // Step 5: Speak
    this.transitionTo('speaking')
    await speak(guidanceResult.text, language)

    // Step 6: Done
    this.transitionTo('idle')

    setTimeout(() => {
      if (!this.overlayWindow.isDestroyed()) {
        this.overlayWindow.webContents.send(IPC.OVERLAY.HIDE)
      }
    }, 8_000)
  }

  private async performVisionGuidance(userQuery: string): Promise<GuidanceResult> {
    const profile = this.configManager.getStoredProfile()
    const language = profile?.language ?? 'sw'
    const flowContext = this.flowService.getCurrentContext(language)

    const screenshotBase64 = await captureScreenshot()
    const screenshotBuffer = Buffer.from(screenshotBase64, 'base64')

    const context = flowContext ?? this.buildDefaultContext(language, userQuery)
    return await getGuidance(screenshotBuffer, userQuery, context)
  }

  private buildDefaultContext(language: 'sw' | 'en', userQuery: string): FlowContext {
    const profile = this.configManager.getStoredProfile()
    return {
      flowId: 'none',
      flowName: language === 'sw' ? 'Msaada wa jumla' : 'General assistance',
      currentStep: 0,
      totalSteps: 0,
      stepInstruction: userQuery,
      language,
      orgCustomInstructions: profile?.customInstructions ?? '',
    }
  }

  // ---------------------------------------------------------------------------
  // State machine
  // ---------------------------------------------------------------------------

  private transitionTo(newState: CompanionState): void {
    console.info(`[CompanionManager] ${this.state} → ${newState}`)
    this.state = newState
    this.broadcast(IPC.COMPANION.STATE_CHANGE, this.getStatus())
  }

  private transitionToError(message: string): void {
    this.lastErrorMessage = message
    this.transitionTo('error')
  }

  private broadcast(channel: string, payload?: unknown): void {
    for (const win of [this.panelWindow, this.overlayWindow]) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  }

  private getLabelEn(state: CompanionState): string {
    const m: Record<CompanionState, string> = {
      idle: 'Ready', listening: 'Listening…', transcribing: 'Transcribing…',
      processing: 'Thinking…', speaking: 'Speaking…', error: 'Error',
    }
    return m[state]
  }

  private getLabelSw(state: CompanionState): string {
    const m: Record<CompanionState, string> = {
      idle: 'Tayari', listening: 'Sikilizando…', transcribing: 'Inabadilisha sauti…',
      processing: 'Inafikiria…', speaking: 'Inasema…', error: 'Hitilafu',
    }
    return m[state]
  }
}
