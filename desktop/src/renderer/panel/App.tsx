/**
 * Panel UI — mirrors CompanionPanelView.swift.
 *
 * Shows the current state, streams Claude's response token-by-token as it
 * types in (just like clicky's progressive text display), and has a PTT
 * button as a click alternative to the keyboard shortcut.
 */

import React, { useEffect, useRef, useState } from 'react'
import type { CompanionStatus } from '../../shared/types'

// ---------------------------------------------------------------------------
// State dot
// ---------------------------------------------------------------------------

const DOT_COLOR: Record<string, string> = {
  idle:       '#6b7280',
  listening:  '#10b981',
  processing: '#3b82f6',
  responding: '#f59e0b',
}

function Dot({ state }: { state: string }): React.ReactElement {
  const pulse = state === 'listening' || state === 'responding'
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${pulse ? 'animate-pulse' : ''}`}
      style={{ backgroundColor: DOT_COLOR[state] ?? '#6b7280' }}
    />
  )
}

// ---------------------------------------------------------------------------
// PTT button
// ---------------------------------------------------------------------------

function PttButton({
  listening,
  disabled,
  onPress,
  onRelease,
}: {
  listening: boolean
  disabled: boolean
  onPress: () => void
  onRelease: () => void
}): React.ReactElement {
  return (
    <button
      className={`
        w-full py-3 rounded-lg font-medium text-sm flex items-center justify-center gap-2
        transition-all duration-150 select-none
        ${listening ? 'bg-green-500 text-black scale-[0.98]' :
          disabled  ? 'bg-gray-700 text-gray-500 cursor-not-allowed' :
                      'bg-gray-700 text-white hover:bg-gray-600 active:scale-[0.98]'}
      `}
      onMouseDown={disabled ? undefined : onPress}
      onMouseUp={disabled ? undefined : onRelease}
      onTouchStart={disabled ? undefined : onPress}
      onTouchEnd={disabled ? undefined : onRelease}
      disabled={disabled}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8"  y1="23" x2="16" y2="23" />
      </svg>
      {listening ? 'Listening… (release to send)' : 'Hold to talk  Ctrl+Shift+Space'}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main app
// ---------------------------------------------------------------------------

export function App(): React.ReactElement {
  const [status, setStatus] = useState<CompanionStatus>({
    state: 'idle', responseText: '', transcript: '', error: '',
  })
  const [streamedText, setStreamedText] = useState('')
  const [listening, setListening] = useState(false)
  const recorder = useRef<MediaRecorder | null>(null)

  useEffect(() => {
    window.api.getStatus().then(setStatus)

    const subs = [
      window.api.onStatus((s) => {
        setStatus(s)
        setListening(s.state === 'listening')
        if (s.state === 'processing') setStreamedText('')
      }),
      window.api.onHotkeyPress(() => { setListening(true); startMic() }),
      window.api.onHotkeyRelease(() => { setListening(false); stopMic() }),
      window.api.onClaudeChunk((chunk) => setStreamedText((t) => t + chunk)),
      window.api.onClaudeDone(() => { /* streaming finished */ }),
      window.api.onTtsPlay((b64) => {
        playAudio(b64).finally(() => window.api.notifyTtsDone())
      }),
      window.api.onWebSpeech((text) => {
        webSpeech(text).finally(() => window.api.notifyWebSpeechDone())
      }),
    ]

    return () => subs.forEach((u) => u())
  }, [])

  // Mic capture
  async function startMic(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      recorder.current = rec
      rec.ondataavailable = (e) => {
        if (!e.data.size) return
        const reader = new FileReader()
        reader.onloadend = () => {
          const b64 = (reader.result as string).split(',')[1]
          window.api.sendAudioChunk(b64)
        }
        reader.readAsDataURL(e.data)
      }
      rec.start(250)
    } catch {
      console.error('[panel] Mic access denied')
    }
  }

  function stopMic(): void {
    const rec = recorder.current
    if (rec && rec.state !== 'inactive') {
      rec.stop()
      rec.stream.getTracks().forEach((t) => t.stop())
      window.api.sendAudioStop()
    }
    recorder.current = null
  }

  // PTT button handlers
  function handlePress(): void {
    if (status.state !== 'idle') return
    setListening(true); startMic()
  }
  function handleRelease(): void {
    setListening(false); stopMic()
  }

  // Audio playback
  async function playAudio(base64: string): Promise<void> {
    const ctx = new AudioContext()
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const buf = await ctx.decodeAudioData(bytes.buffer)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    return new Promise((res) => { src.onended = () => res(); src.start() })
  }

  async function webSpeech(text: string): Promise<void> {
    return new Promise((res) => {
      if (!window.speechSynthesis) { res(); return }
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.rate = 0.95
      u.onend = () => res()
      u.onerror = () => res()
      window.speechSynthesis.speak(u)
    })
  }

  const { state, transcript, error } = status
  const display = streamedText || status.responseText

  return (
    <div className="h-screen flex flex-col bg-[#0d1117] text-white select-none" style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
        <div className="w-7 h-7 rounded-lg bg-green-500 flex items-center justify-center text-black font-bold text-sm">M</div>
        <div className="flex-1">
          <p className="text-sm font-semibold">Mwongozo</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Dot state={state} />
            <span className="text-xs text-gray-400 capitalize">{state}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">
            {error}
            <button onClick={() => window.api.reset()} className="mt-2 w-full py-1.5 rounded bg-red-500/20 text-red-400 text-xs hover:bg-red-500/30">
              Reset
            </button>
          </div>
        )}

        {transcript && (
          <p className="text-xs text-gray-500 italic border-l-2 border-green-500/40 pl-2">
            "{transcript}"
          </p>
        )}

        {display ? (
          <div className="bg-[#161b22] rounded-lg p-3 text-sm leading-relaxed text-gray-100">
            {display}
            {state === 'processing' && <span className="animate-pulse ml-0.5">▋</span>}
          </div>
        ) : state === 'idle' && (
          <div className="text-center py-10 text-gray-500 text-sm space-y-2">
            <p className="text-3xl">🎙️</p>
            <p>Hold <kbd className="px-1.5 py-0.5 rounded bg-gray-700 text-xs font-mono">Ctrl+Shift+Space</kbd> and speak</p>
            <p className="text-xs opacity-60">or use the button below</p>
          </div>
        )}

        {state === 'processing' && !display && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity="0.25" />
              <path d="M21 12a9 9 0 00-9-9" />
            </svg>
            <span>Thinking…</span>
          </div>
        )}
      </div>

      {/* PTT button */}
      <div className="px-4 pb-4 pt-2 border-t border-white/10">
        <PttButton
          listening={listening}
          disabled={state !== 'idle' && state !== 'listening'}
          onPress={handlePress}
          onRelease={handleRelease}
        />
      </div>
    </div>
  )
}
