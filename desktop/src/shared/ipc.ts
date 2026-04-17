/**
 * IPC channel registry — mirrors clicky's approach: all channels defined here,
 * never hard-coded anywhere else.
 */
export const IPC = {
  // Companion state broadcast (main → both renderers)
  STATUS:       'status',

  // Hotkey (main → renderer)
  HOTKEY_PRESS:    'hotkey:press',
  HOTKEY_RELEASE:  'hotkey:release',

  // Audio (renderer → main)
  AUDIO_CHUNK:  'audio:chunk',
  AUDIO_STOP:   'audio:stop',

  // Claude streaming chunks (main → panel renderer)
  CLAUDE_CHUNK: 'claude:chunk',
  CLAUDE_DONE:  'claude:done',

  // TTS (main → panel renderer for Web Audio playback)
  TTS_PLAY:           'tts:play',
  TTS_DONE:           'tts:done',
  TTS_WEB_SPEECH:     'tts:web-speech',
  TTS_WEB_SPEECH_DONE:'tts:web-speech-done',

  // Overlay (main → overlay renderer)
  OVERLAY_SHOW:  'overlay:show',
  OVERLAY_HIDE:  'overlay:hide',
  OVERLAY_POINT: 'overlay:point',
  OVERLAY_TEXT:  'overlay:text',

  // Overlay streaming response (main → overlay renderer)
  // Shows AI response text as a floating bubble near the cursor while streaming,
  // so the user never has to look away from their work (clicky-style UX).
  OVERLAY_RESPONSE_START: 'overlay:response:start',  // {x,y} display-local cursor pos
  OVERLAY_RESPONSE_CHUNK: 'overlay:response:chunk',  // string chunk to append
  OVERLAY_RESPONSE_DONE:  'overlay:response:done',   // streaming complete

  // Orb ↔ main
  CURSOR_MOVE:   'cursor:move',    // main → orb renderer (16 ms poll)
  ORB_CLICK:     'orb:click',      // orb renderer → main (toggle panel)

  // invoke channels (renderer → main, returns Promise)
  GET_STATUS:    'get-status',
  RESET:         'reset',
  MANUAL_QUERY:  'query:manual',   // typed question from panel UI

  // Orb customisation (renderer ↔ main)
  GET_ORB_CONFIG: 'orb:get-config',   // renderer invoke → main returns OrbConfig
  SET_ORB_CONFIG: 'orb:set-config',   // renderer invoke → main saves + broadcasts
  ORB_CONFIG:     'orb:config',       // main → all renderers on change

  // Proxy URL (renderer ↔ main)
  GET_PROXY_URL:  'proxy:get-url',
  SET_PROXY_URL:  'proxy:set-url',

  // Voice transcription (renderer → main → proxy Groq/AssemblyAI)
  TRANSCRIBE_AUDIO: 'transcribe:audio',

  // Persistent conversation history (renderer ↔ main)
  GET_HISTORY:   'history:get',    // renderer invoke → returns HistoryEntry[]
  CLEAR_HISTORY: 'history:clear',  // renderer invoke → clears file + in-memory context
} as const
