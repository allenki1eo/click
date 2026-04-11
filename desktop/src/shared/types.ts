// Shared TypeScript interfaces used by both main and renderer processes.
// Keep this file free of Node.js or browser-specific imports.

// ---------------------------------------------------------------------------
// Org / Config
// ---------------------------------------------------------------------------

export interface OrgProfile {
  orgId: string
  orgName: string
  logoUrl: string
  /** Which flow IDs this org code has unlocked */
  flowAccess: string[]
  language: 'sw' | 'en'
  /** Org-specific context injected into every AI prompt */
  customInstructions: string
  /** Whether session transcripts/screenshots may be sent to analytics backend */
  analyticsEnabled: boolean
  /** The raw code used to activate — stored so we can display it in settings */
  activationCode: string
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

export interface FlowStep {
  step: number
  title: string
  title_sw: string
  instruction: string
  instruction_sw: string
  /** Plain-English description of what the screen should look like at this step */
  expected_screen: string
  /** Plain-English description of what indicates the step succeeded */
  success_indicator?: string
  /** Label of the UI element the user should click — used in the AI prompt */
  point_target?: string
}

export interface Flow {
  id: string
  name: string
  name_sw: string
  /** The portal URL for this flow — shown in the panel for quick navigation */
  portal: string
  steps: FlowStep[]
}

/** Everything the AI needs to know about what the user is currently doing */
export interface FlowContext {
  flowId: string
  flowName: string
  currentStep: number
  totalSteps: number
  stepInstruction: string
  language: 'sw' | 'en'
  orgCustomInstructions: string
}

// ---------------------------------------------------------------------------
// AI / Vision
// ---------------------------------------------------------------------------

/** A parsed [POINT:x:y:label:screenN] tag from an AI response */
export interface PointTarget {
  x: number
  y: number
  label: string
  /** Which screen index (multi-monitor) this point belongs to */
  screenIndex: number
}

export interface GuidanceResult {
  /** The AI response text with POINT tags stripped out */
  text: string
  /** Extracted POINT targets ready for the overlay to render */
  points: PointTarget[]
  /** 0–1 confidence score. Below 0.7 triggers Claude fallback. */
  confidence: number
  /** Which model actually produced this response */
  modelUsed: 'qwen2.5-vl' | 'claude-sonnet' | 'mock'
  /** Raw response before POINT tag parsing */
  rawResponse: string
}

// ---------------------------------------------------------------------------
// Sessions (analytics)
// ---------------------------------------------------------------------------

export type SessionState = 'active' | 'completed' | 'abandoned' | 'error'

export interface SessionEvent {
  userId?: string
  orgId?: string
  flowId?: string
  flowStep?: number
  state: SessionState
  durationSeconds?: number
  transcript?: string
  aiResponse?: string
  modelUsed?: string
  screenshotTaken?: boolean
}

// ---------------------------------------------------------------------------
// Companion state machine
// ---------------------------------------------------------------------------

/**
 * States of the CompanionManager state machine.
 *
 *   idle ──(hotkey press)──► listening
 *   listening ──(hotkey release)──► transcribing
 *   transcribing ──(done)──► processing
 *   processing ──(vision result)──► speaking
 *   speaking ──(TTS done)──► idle
 *   * ──(error)──► error ──(reset)──► idle
 */
export type CompanionState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'processing'
  | 'speaking'
  | 'error'

export interface CompanionStatus {
  state: CompanionState
  /** Human-readable label in the user's language */
  label: string
  label_sw: string
  /** Current flow, if one is active */
  activeFlowId?: string
  activeFlowStep?: number
  lastGuidance?: GuidanceResult
  errorMessage?: string
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export interface AudioChunk {
  /** Raw PCM buffer captured from microphone */
  data: Buffer
  sampleRate: number
  channels: number
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export interface ActivateCodeRequest {
  code: string
  /** Client app version, for analytics */
  appVersion: string
}

export interface ActivateCodeResponse {
  success: boolean
  profile?: OrgProfile
  error?: string
}
