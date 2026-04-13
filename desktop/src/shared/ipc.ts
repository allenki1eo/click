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

  // Orb ↔ main
  CURSOR_MOVE:   'cursor:move',    // main → orb renderer (16 ms poll)
  ORB_CLICK:     'orb:click',      // orb renderer → main (toggle panel)

  // invoke channels (renderer → main, returns Promise)
  GET_STATUS:    'get-status',
  RESET:         'reset',
  MANUAL_QUERY:  'query:manual',   // typed question from panel UI
} as const
