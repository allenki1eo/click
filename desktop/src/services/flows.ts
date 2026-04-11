/**
 * Flow service — loads and manages pre-mapped portal navigation flows.
 *
 * New module (no Clicky equivalent).
 *
 * Flows are JSON files bundled with the app in the /flows/ directory.
 * The FlowService:
 *  1. Reads available flows from the filesystem at startup
 *  2. Tracks which flow is currently active and at which step
 *  3. Provides FlowContext to the vision service for prompt injection
 *  4. Advances steps when the AI or user signals completion
 *
 * In packaged builds, flows live in app.getPath('userData') or as
 * extraResources in the app bundle (see electron-builder config).
 */

import { ipcMain, app } from 'electron'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { IPC } from '../shared/ipc'
import type { Flow, FlowContext } from '../shared/types'

export class FlowService {
  private readonly availableFlows = new Map<string, Flow>()
  private activeFlowId: string | null = null
  private currentStep = 1

  constructor() {
    this.loadAllFlows()
    this.registerIpcHandlers()
  }

  // ---------------------------------------------------------------------------
  // Flow loading
  // ---------------------------------------------------------------------------

  private loadAllFlows(): void {
    const flowsDir = this.resolveFlowsDirectory()

    if (!existsSync(flowsDir)) {
      console.warn(`[FlowService] Flows directory not found: ${flowsDir}`)
      return
    }

    const files = readdirSync(flowsDir).filter((f) => f.endsWith('.json'))

    for (const file of files) {
      try {
        const raw = readFileSync(join(flowsDir, file), 'utf-8')
        const flow = JSON.parse(raw) as Flow
        this.availableFlows.set(flow.id, flow)
        console.info(`[FlowService] Loaded flow: ${flow.id} (${flow.steps.length} steps)`)
      } catch (err) {
        console.error(`[FlowService] Failed to load flow ${file}:`, err)
      }
    }

    console.info(`[FlowService] Total flows loaded: ${this.availableFlows.size}`)
  }

  /**
   * Resolves the directory containing flow JSON files.
   *
   * In development: relative to the project root (../../flows from services/)
   * In packaged build: electron-builder copies flows/ to extraResources,
   *   which is accessible at process.resourcesPath/flows/
   */
  private resolveFlowsDirectory(): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, 'flows')
    }
    // Dev: flows/ sits next to desktop/ in the repo root
    return join(app.getAppPath(), '..', 'flows')
  }

  // ---------------------------------------------------------------------------
  // Flow management
  // ---------------------------------------------------------------------------

  loadFlow(flowId: string): Flow | null {
    const flow = this.availableFlows.get(flowId)
    if (!flow) {
      console.warn(`[FlowService] Flow not found: ${flowId}`)
      return null
    }
    this.activeFlowId = flowId
    this.currentStep = 1
    console.info(`[FlowService] Activated flow: ${flowId}, starting at step 1`)
    return flow
  }

  getCurrentContext(language: 'sw' | 'en', orgCustomInstructions = ''): FlowContext | null {
    if (!this.activeFlowId) return null

    const flow = this.availableFlows.get(this.activeFlowId)
    if (!flow) return null

    const step = flow.steps.find((s) => s.step === this.currentStep)
    if (!step) return null

    return {
      flowId: flow.id,
      flowName: language === 'sw' ? flow.name_sw : flow.name,
      currentStep: this.currentStep,
      totalSteps: flow.steps.length,
      stepInstruction: language === 'sw' ? step.instruction_sw : step.instruction,
      language,
      orgCustomInstructions
    }
  }

  advanceStep(): FlowContext | null {
    if (!this.activeFlowId) return null

    const flow = this.availableFlows.get(this.activeFlowId)
    if (!flow) return null

    if (this.currentStep < flow.steps.length) {
      this.currentStep++
      console.info(`[FlowService] Advanced to step ${this.currentStep}/${flow.steps.length}`)
    } else {
      console.info(`[FlowService] Flow ${this.activeFlowId} completed!`)
    }

    return this.getCurrentContext('sw')
  }

  setStep(step: number): void {
    if (!this.activeFlowId) return
    const flow = this.availableFlows.get(this.activeFlowId)
    if (!flow) return

    this.currentStep = Math.max(1, Math.min(step, flow.steps.length))
    console.info(`[FlowService] Jumped to step ${this.currentStep}`)
  }

  getAvailableFlowIds(): string[] {
    return Array.from(this.availableFlows.keys())
  }

  // ---------------------------------------------------------------------------
  // IPC handler registration
  // ---------------------------------------------------------------------------

  private registerIpcHandlers(): void {
    ipcMain.handle(IPC.FLOW.LOAD, (_, flowId: string) => {
      return this.loadFlow(flowId)
    })

    ipcMain.handle(IPC.FLOW.GET_STATE, () => {
      // Language comes from org profile — default to sw for now
      return this.getCurrentContext('sw')
    })

    ipcMain.handle(IPC.FLOW.NEXT_STEP, () => {
      return this.advanceStep()
    })

    ipcMain.handle(IPC.FLOW.SET_STEP, (_, step: number) => {
      this.setStep(step)
    })
  }
}
