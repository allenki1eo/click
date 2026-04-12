/**
 * IPC channel name registry.
 *
 * ALL IPC communication between main and renderer MUST go through named
 * channels defined here. Never hard-code channel name strings elsewhere.
 *
 * Convention: VERB:NOUN  (matches Clicky's pattern)
 *   invoke/handle channels return a Promise (use ipcRenderer.invoke)
 *   send/on channels are fire-and-forget (use ipcRenderer.send / ipcMain.on)
 */

export const IPC = {
  // ---------------------------------------------------------------------------
  // Screenshot
  // ---------------------------------------------------------------------------
  SCREENSHOT: {
    /** invoke → returns base64 PNG of the primary screen */
    CAPTURE: 'SCREENSHOT:CAPTURE'
  },

  // ---------------------------------------------------------------------------
  // Flow management
  // ---------------------------------------------------------------------------
  FLOW: {
    /** invoke(flowId: string) → Flow | null */
    LOAD: 'FLOW:LOAD',
    /** invoke() → FlowContext | null */
    GET_STATE: 'FLOW:GET_STATE',
    /** invoke(step: number) — manually jump to a step (debug/admin use) */
    SET_STEP: 'FLOW:SET_STEP',
    /** invoke() — advance to the next step */
    NEXT_STEP: 'FLOW:NEXT_STEP',
    /** send → main broadcasts this whenever the active step changes */
    STEP_CHANGED: 'FLOW:STEP_CHANGED'
  },

  // ---------------------------------------------------------------------------
  // Companion state machine
  // ---------------------------------------------------------------------------
  COMPANION: {
    /** send → main broadcasts CompanionStatus whenever state transitions */
    STATE_CHANGE: 'COMPANION:STATE_CHANGE',
    /** invoke() → CompanionStatus */
    GET_STATUS: 'COMPANION:GET_STATUS',
    /** invoke() → void — reset from error state back to idle */
    RESET: 'COMPANION:RESET'
  },

  // ---------------------------------------------------------------------------
  // Hotkey (push-to-talk)
  // ---------------------------------------------------------------------------
  HOTKEY: {
    /** send → main → renderer: user pressed the PTT hotkey */
    PRESS: 'HOTKEY:PRESS',
    /** send → main → renderer: user released the PTT hotkey */
    RELEASE: 'HOTKEY:RELEASE'
  },

  // ---------------------------------------------------------------------------
  // Audio recording (mic captured in renderer, sent to main for transcription)
  // ---------------------------------------------------------------------------
  AUDIO: {
    /** send(base64wav: string) → renderer sends WAV chunk to main */
    CHUNK: 'AUDIO:CHUNK',
    /** send → renderer tells main recording has stopped */
    STOP: 'AUDIO:STOP'
  },

  // ---------------------------------------------------------------------------
  // Transcription result
  // ---------------------------------------------------------------------------
  TRANSCRIPTION: {
    /** send(text: string) → main broadcasts transcription result to renderer */
    RESULT: 'TRANSCRIPTION:RESULT'
  },

  // ---------------------------------------------------------------------------
  // Vision / AI guidance
  // ---------------------------------------------------------------------------
  VISION: {
    /** invoke(query: string) → GuidanceResult */
    REQUEST: 'VISION:REQUEST',
    /** send(result: GuidanceResult) → main broadcasts result to renderer */
    RESULT: 'VISION:RESULT'
  },

  // ---------------------------------------------------------------------------
  // TTS
  // ---------------------------------------------------------------------------
  TTS: {
    /** invoke(text: string) → void — main calls TTS and plays audio */
    SPEAK: 'TTS:SPEAK',
    /** send → main broadcasts when TTS playback finishes */
    DONE: 'TTS:DONE',
    /** send(base64mp3: string) → main asks renderer to play audio via Web Audio API */
    PLAY_AUDIO: 'TTS:PLAY_AUDIO',
    /** send → renderer notifies main that Web Audio playback finished */
    AUDIO_DONE: 'TTS:AUDIO_DONE',
    /** send({ text, language }) → main asks renderer to use Web Speech API (offline fallback) */
    WEB_SPEECH: 'TTS:WEB_SPEECH',
    /** send → renderer notifies main that Web Speech playback finished */
    WEB_SPEECH_DONE: 'TTS:WEB_SPEECH_DONE'
  },

  // ---------------------------------------------------------------------------
  // Overlay window
  // ---------------------------------------------------------------------------
  OVERLAY: {
    /** send → show the overlay */
    SHOW: 'OVERLAY:SHOW',
    /** send → hide the overlay */
    HIDE: 'OVERLAY:HIDE',
    /**
     * send({ x, y, label, screenIndex }) → animate the cursor pointer to these
     * screen coordinates. The overlay window handles the animation.
     */
    POINT: 'OVERLAY:POINT',
    /** send(text: string) → update the text bubble in the overlay */
    SET_TEXT: 'OVERLAY:SET_TEXT'
  },

  // ---------------------------------------------------------------------------
  // Config / org profile
  // ---------------------------------------------------------------------------
  CONFIG: {
    /** invoke() → OrgProfile | null */
    GET_PROFILE: 'CONFIG:GET_PROFILE',
    /** invoke(request: ActivateCodeRequest) → ActivateCodeResponse */
    ACTIVATE_CODE: 'CONFIG:ACTIVATE_CODE',
    /** invoke() → void — clears the stored org profile (logout / reset) */
    CLEAR_PROFILE: 'CONFIG:CLEAR_PROFILE'
  },

  // ---------------------------------------------------------------------------
  // Session analytics
  // ---------------------------------------------------------------------------
  SESSION: {
    /** send(event: SessionEvent) → main logs this to Supabase (if analytics on) */
    LOG: 'SESSION:LOG'
  },

  // ---------------------------------------------------------------------------
  // Window management
  // ---------------------------------------------------------------------------
  WINDOW: {
    /** invoke() → open / focus the onboarding window */
    SHOW_ONBOARDING: 'WINDOW:SHOW_ONBOARDING',
    /** invoke() → close the onboarding window */
    CLOSE_ONBOARDING: 'WINDOW:CLOSE_ONBOARDING',
    /** invoke() → toggle the tray panel window */
    TOGGLE_PANEL: 'WINDOW:TOGGLE_PANEL'
  }
} as const

// Derive a union type of all channel strings (useful for strict typing in handlers)
type ExtractChannels<T> = T extends Record<string, infer V>
  ? V extends string
    ? V
    : ExtractChannels<V>
  : never

export type IpcChannel = ExtractChannels<typeof IPC>
