/** Companion state machine — mirrors CompanionManager.swift */
export type CompanionState = 'idle' | 'listening' | 'processing' | 'responding'

/** One turn in the conversation history (last 10 kept, like clicky) */
export interface Message {
  role: 'user' | 'assistant'
  content: string
}

/** Parsed [POINT:x,y:label:screenN] tag from Claude response */
export interface PointTarget {
  x: number
  y: number
  label: string
  screenIndex: number
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
