/**
 * CompanionManager — central state machine for the AI companion.
 *
 * Ported from CompanionManager.swift (Clicky).
 *
 * State transitions:
 *   idle ──(hotkeyPress)──► listening
 *   listening ──(hotkeyRelease)──► transcribing
 *   transcribing ──(transcriptionResult)──► processing
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
import { speak } from '../services/tts/kokoro'

interface CompanionManagerOptions {
  panelWindow: BrowserWindow
  overlayWindow: BrowserWindow
  configManager: ConfigManager
}

export class CompanionManager {
  private state: CompanionState = 'idle'
  private readonly panelWindow: BrowserWindow
  private readonly overlayWindow: BrowserWindow
  private readonly configManager: ConfigManager
  private readonly flowService: FlowService

  /** Accumulated audio WAV chunks from the renderer while push-to-talk is held */
  private pendingAudioChunks: Buffer[] = []

  constructor(options: CompanionManagerOptions) {
    this.panelWindow = options.panelWindow
    this.overlayWindow = options.overlayWindow
    this.configManager = options.configManager
    this.flowService = new FlowService()
  }

  // ---------------------------------------------------------------------------
  // Public API (called by HotkeyManager and audio handlers)
  // ---------------------------------------------------------------------------

  onHotkeyPress(): void {
    if (this.state !== 'idle') return
    this.pendingAudioChunks = []
    this.transitionTo('listening')

    // Notify both windows so UI can update immediately
    this.broadcast(IPC.HOTKEY.PRESS)
  }

  onHotkeyRelease(): void {
    if (this.state !== 'listening') return
    this.transitionTo('transcribing')
    this.broadcast(IPC.HOTKEY.RELEASE)

    // Kick off the async processing pipeline
    this.runProcessingPipeline().catch((err) => {
      console.error('[CompanionManager] pipeline error:', err)
      this.transitionTo('error')
    })
  }

  onAudioChunk(wavBase64: string): void {
    if (this.state !== 'listening') return
    this.pendingAudioChunks.push(Buffer.from(wavBase64, 'base64'))
  }

  reset(): void {
    this.transitionTo('idle')
    this.pendingAudioChunks = []
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
      activeFlowStep: flowContext?.currentStep
    }
  }

  // ---------------------------------------------------------------------------
  // IPC handler registration
  // ---------------------------------------------------------------------------

  registerIpcHandlers(): void {
    ipcMain.handle(IPC.COMPANION.GET_STATUS, () => this.getStatus())

    ipcMain.handle(IPC.VISION.REQUEST, async (_, userQuery: string) => {
      return await this.performVisionGuidance(userQuery)
    })
  }

  // ---------------------------------------------------------------------------
  // Core pipeline: transcribe → screenshot → vision → TTS → overlay
  // ---------------------------------------------------------------------------

  private async runProcessingPipeline(): Promise<void> {
    const profile = this.configManager.getStoredProfile()
    const language = profile?.language ?? 'sw'

    // Step 1: Transcribe audio (if any was captured)
    let userQuery = ''
    if (this.pendingAudioChunks.length > 0) {
      const combinedWav = Buffer.concat(this.pendingAudioChunks)
      this.pendingAudioChunks = []

      const { transcribeAudio } = await import('../services/transcription/whisper')
      userQuery = await transcribeAudio(combinedWav)

      // Broadcast transcription so the panel can show what was heard
      this.broadcast(IPC.TRANSCRIPTION.RESULT, userQuery)
    }

    // Step 2: Transition to processing while we call vision
    this.transitionTo('processing')

    const guidanceResult = await this.performVisionGuidance(userQuery)

    // Step 3: Show guidance on the overlay
    this.overlayWindow.webContents.send(IPC.OVERLAY.SET_TEXT, guidanceResult.text)
    this.overlayWindow.webContents.send(IPC.OVERLAY.SHOW)
    this.overlayWindow.show()

    if (guidanceResult.points.length > 0) {
      const firstPoint = guidanceResult.points[0]
      this.overlayWindow.webContents.send(IPC.OVERLAY.POINT, firstPoint)
    }

    // Step 4: Broadcast guidance result to panel
    this.broadcast(IPC.VISION.RESULT, guidanceResult)

    // Step 5: Speak the guidance text via TTS
    this.transitionTo('speaking')
    await speak(guidanceResult.text, language)

    // Step 6: Return to idle
    this.transitionTo('idle')

    // Optionally auto-hide the overlay after a few seconds
    setTimeout(() => {
      this.overlayWindow.webContents.send(IPC.OVERLAY.HIDE)
    }, 8000)
  }

  private async performVisionGuidance(userQuery: string): Promise<GuidanceResult> {
    const profile = this.configManager.getStoredProfile()
    const language = profile?.language ?? 'sw'
    const flowContext = this.flowService.getCurrentContext(language)

    // Capture primary screen — user is shown a tray indicator during this
    const screenshotBase64 = await captureScreenshot()
    const screenshotBuffer = Buffer.from(screenshotBase64, 'base64')

    return await getGuidance(screenshotBuffer, userQuery, flowContext ?? this.buildDefaultContext(language, userQuery))
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
      orgCustomInstructions: profile?.customInstructions ?? ''
    }
  }

  // ---------------------------------------------------------------------------
  // State machine helpers
  // ---------------------------------------------------------------------------

  private transitionTo(newState: CompanionState): void {
    const previousState = this.state
    this.state = newState
    console.info(`[CompanionManager] ${previousState} → ${newState}`)

    const status = this.getStatus()
    this.broadcast(IPC.COMPANION.STATE_CHANGE, status)
  }

  /** Send an IPC event to all renderer windows */
  private broadcast(channel: string, payload?: unknown): void {
    const windows = [this.panelWindow, this.overlayWindow]
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload)
      }
    }
  }

  private getLabelEn(state: CompanionState): string {
    const labels: Record<CompanionState, string> = {
      idle: 'Ready',
      listening: 'Listening...',
      transcribing: 'Transcribing...',
      processing: 'Thinking...',
      speaking: 'Speaking...',
      error: 'Error'
    }
    return labels[state]
  }

  private getLabelSw(state: CompanionState): string {
    const labels: Record<CompanionState, string> = {
      idle: 'Tayari',
      listening: 'Sikilizando...',
      transcribing: 'Inabadilisha sauti...',
      processing: 'Inafikiria...',
      speaking: 'Inasema...',
      error: 'Hitilafu'
    }
    return labels[state]
  }
}

