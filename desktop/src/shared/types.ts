/** Companion state machine — mirrors CompanionManager.swift */
export type CompanionState = 'idle' | 'listening' | 'processing' | 'responding'

/** One turn in the conversation history (last 10 kept, like clicky) */
export interface Message {
  role: 'user' | 'assistant'
  content: string
}

/** Orb appearance and personality config — persisted in electron-store */
export interface OrbConfig {
  name: string
  theme: string   // hex colour, e.g. "#10b981"
  personality: 'friendly' | 'professional' | 'playful' | 'concise'
  /** When true, continuous speech recognition listens for "Hey Mwongozo" */
  wakeWordEnabled: boolean
}

/** Parsed [POINT:x,y:label:screenN] or [STEP:n:x,y:label:screenN] tag from Claude response */
export interface PointTarget {
  x: number
  y: number
  label: string
  screenIndex: number
  /** 1-based step number when part of a multi-step sequence */
  stepIndex?: number
  /** Total number of steps in the sequence */
  stepTotal?: number
}

/** Full UI state pushed to the renderer on every state change */
export interface CompanionStatus {
  state: CompanionState
  /** Streaming text accumulator — shown as Claude types */
  responseText: string
  /** Final transcript from AssemblyAI */
  transcript: string
  error: string
}
