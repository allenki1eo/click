/**
 * Panel UI — two tabs:
 *  • Chat     — streams AI responses, voice PTT, text input
 *  • Customize — orb name, colour theme, personality
 */

import React, { useEffect, useRef, useState } from 'react'
import type { CompanionStatus, OrbConfig } from '../../shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DOT_COLOR: Record<string, string> = {
  idle:       '#6b7280',
  listening:  '#10b981',
  processing: '#3b82f6',
  responding: '#f59e0b',
}

function Dot({ state, theme }: { state: string; theme: string }): React.ReactElement {
  const pulse = state === 'listening' || state === 'responding'
  const color = state === 'listening' || state === 'responding' ? theme : DOT_COLOR[state] ?? '#6b7280'
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${pulse ? 'animate-pulse' : ''}`}
      style={{ backgroundColor: color }}
    />
  )
}

// ---------------------------------------------------------------------------
// PTT button
// ---------------------------------------------------------------------------

function PttButton({
  listening, disabled, theme, onPress, onRelease,
}: {
  listening: boolean; disabled: boolean; theme: string
  onPress: () => void; onRelease: () => void
}): React.ReactElement {
  return (
    <button
      className={`
        w-full py-3 rounded-lg font-medium text-sm flex items-center justify-center gap-2
        transition-all duration-150 select-none
        ${disabled && !listening ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : ''}
        ${listening ? 'text-black scale-[0.98]' : !disabled ? 'bg-gray-700 text-white hover:bg-gray-600 active:scale-[0.98]' : ''}
      `}
      style={listening ? { backgroundColor: theme } : undefined}
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
// Chat tab
// ---------------------------------------------------------------------------

function ChatTab({
  status, streamedText, listening, textInput, theme, orbName,
  setTextInput, onPress, onRelease, onTextSubmit,
}: {
  status: CompanionStatus
  streamedText: string
  listening: boolean
  textInput: string
  theme: string
  orbName: string
  setTextInput: (v: string) => void
  onPress: () => void
  onRelease: () => void
  onTextSubmit: (e: React.FormEvent) => void
}): React.ReactElement {
  const { state, transcript, error } = status
  const display = streamedText || status.responseText
  const isIdle  = state === 'idle'

  return (
    <>
      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">
            {error}
            <button onClick={() => window.api.reset()} className="mt-2 w-full py-1.5 rounded bg-red-500/20 text-red-400 text-xs hover:bg-red-500/30">
              Reset
            </button>
          </div>
        )}

        {transcript && (
          <p className="text-xs text-gray-500 italic border-l-2 pl-2" style={{ borderColor: theme + '66' }}>
            "{transcript}"
          </p>
        )}

        {display ? (
          <div className="bg-[#161b22] rounded-lg p-3 text-sm leading-relaxed text-gray-100">
            {display}
            {state === 'processing' && <span className="animate-pulse ml-0.5">▋</span>}
          </div>
        ) : isIdle && (
          <div className="text-center py-6 text-gray-500 text-sm space-y-2">
            <p className="text-3xl">🎙️</p>
            <p>Hold <kbd className="px-1.5 py-0.5 rounded bg-gray-700 text-xs font-mono">Ctrl+Shift+Space</kbd> and speak</p>
            <p className="text-xs opacity-60">or type your question below</p>
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

      {/* Text input */}
      <div className="px-4 pt-2 pb-1 border-t border-white/10">
        <form onSubmit={onTextSubmit} className="flex gap-2">
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            disabled={!isIdle}
            placeholder={isIdle ? `Ask ${orbName}…` : state + '…'}
            className="
              flex-1 bg-[#161b22] border border-white/10 rounded-lg px-3 py-2
              text-sm text-white placeholder-gray-600
              focus:outline-none
              disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors
            "
            style={{ outlineColor: theme }}
            onFocus={(e) => { e.currentTarget.style.borderColor = theme + '99' }}
            onBlur={(e)  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
          />
          <button
            type="submit"
            disabled={!isIdle || !textInput.trim()}
            title="Send"
            className="px-3 py-2 rounded-lg text-white hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
            style={{ backgroundColor: theme }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </div>

      {/* PTT button */}
      <div className="px-4 pb-4 pt-1">
        <PttButton
          listening={listening}
          disabled={!isIdle && !listening}
          theme={theme}
          onPress={onPress}
          onRelease={onRelease}
        />
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Colour swatches
// ---------------------------------------------------------------------------

const THEMES = [
  { label: 'Emerald',  hex: '#10b981' },
  { label: 'Sky',      hex: '#38bdf8' },
  { label: 'Violet',   hex: '#8b5cf6' },
  { label: 'Rose',     hex: '#f43f5e' },
  { label: 'Amber',    hex: '#f59e0b' },
  { label: 'Slate',    hex: '#94a3b8' },
]

const PERSONALITIES: { value: OrbConfig['personality']; label: string; desc: string }[] = [
  { value: 'friendly',     label: 'Friendly',     desc: 'Warm and helpful' },
  { value: 'professional', label: 'Professional',  desc: 'Precise and formal' },
  { value: 'playful',      label: 'Playful',       desc: 'Fun and enthusiastic' },
  { value: 'concise',      label: 'Concise',       desc: 'Short answers only' },
]

// ---------------------------------------------------------------------------
// Customize tab
// ---------------------------------------------------------------------------

function CustomizeTab({
  config, onSave,
}: {
  config: OrbConfig
  onSave: (cfg: Partial<OrbConfig>) => void
}): React.ReactElement {
  const [name, setName] = useState(config.name)

  // Sync if parent config changes
  useEffect(() => { setName(config.name) }, [config.name])

  function handleNameBlur(): void {
    const trimmed = name.trim() || 'Mwongozo'
    setName(trimmed)
    if (trimmed !== config.name) onSave({ name: trimmed })
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">

      {/* Name */}
      <section>
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Companion name
        </label>
        <input
          type="text"
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          className="
            w-full bg-[#161b22] border border-white/10 rounded-lg px-3 py-2
            text-sm text-white focus:outline-none transition-colors
          "
          onFocus={(e) => { e.currentTarget.style.borderColor = config.theme + '99' }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
            handleNameBlur()
          }}
        />
      </section>

      {/* Colour theme */}
      <section>
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Colour theme
        </label>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map((t) => (
            <button
              key={t.hex}
              onClick={() => onSave({ theme: t.hex })}
              className={`
                flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all
                ${config.theme === t.hex
                  ? 'border-white/40 bg-white/8'
                  : 'border-white/10 hover:border-white/25 bg-white/4'}
              `}
            >
              <span
                className="w-4 h-4 rounded-full flex-shrink-0 ring-2 ring-offset-1 ring-offset-[#0d1117]"
                style={{
                  backgroundColor: t.hex,
                  ringColor: config.theme === t.hex ? t.hex : 'transparent',
                  boxShadow: config.theme === t.hex ? `0 0 0 2px ${t.hex}` : 'none',
                }}
              />
              <span className="text-gray-300 text-xs">{t.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Personality */}
      <section>
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Personality
        </label>
        <div className="space-y-2">
          {PERSONALITIES.map((p) => (
            <button
              key={p.value}
              onClick={() => onSave({ personality: p.value })}
              className={`
                w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-left transition-all
                ${config.personality === p.value
                  ? 'border-white/40 bg-white/8'
                  : 'border-white/10 hover:border-white/25 bg-white/4'}
              `}
            >
              <div>
                <p className="text-sm text-white">{p.label}</p>
                <p className="text-xs text-gray-500">{p.desc}</p>
              </div>
              {config.personality === p.value && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: config.theme }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </section>

    </div>
  )
}

// ---------------------------------------------------------------------------
// Main app
// ---------------------------------------------------------------------------

type Tab = 'chat' | 'customize'

export function App(): React.ReactElement {
  const [status, setStatus] = useState<CompanionStatus>({
    state: 'idle', responseText: '', transcript: '', error: '',
  })
  const [streamedText, setStreamedText] = useState('')
  const [listening, setListening] = useState(false)
  const [textInput, setTextInput]   = useState('')
  const [tab, setTab]               = useState<Tab>('chat')
  const [orbCfg, setOrbCfg] = useState<OrbConfig>({
    name: 'Mwongozo', theme: '#10b981', personality: 'friendly',
  })
  const recorder = useRef<MediaRecorder | null>(null)

  useEffect(() => {
    window.api.getStatus().then(setStatus)
    window.api.getOrbConfig().then(setOrbCfg)

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
      window.api.onOrbConfig((cfg) => setOrbCfg(cfg)),
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

  function handlePress(): void {
    if (status.state !== 'idle') return
    setListening(true); startMic()
  }
  function handleRelease(): void {
    setListening(false); stopMic()
  }

  async function handleTextSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const q = textInput.trim()
    if (!q || status.state !== 'idle') return
    setTextInput('')
    setStreamedText('')
    await window.api.submitQuery(q)
  }

  async function handleSaveConfig(cfg: Partial<OrbConfig>): Promise<void> {
    await window.api.setOrbConfig(cfg)
    // Optimistic update — the IPC broadcast will also fire but this is instant
    setOrbCfg((prev) => ({ ...prev, ...cfg }))
  }

  async function playAudio(base64: string): Promise<void> {
    const ctx  = new AudioContext()
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const buf  = await ctx.decodeAudioData(bytes.buffer)
    const src  = ctx.createBufferSource()
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
      u.onend  = () => res()
      u.onerror = () => res()
      window.speechSynthesis.speak(u)
    })
  }

  const { theme, name: orbName } = orbCfg

  return (
    <div className="h-screen flex flex-col bg-[#0d1117] text-white select-none" style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-black font-bold text-sm flex-shrink-0"
          style={{ backgroundColor: theme }}
        >
          {orbName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{orbName}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Dot state={status.state} theme={theme} />
            <span className="text-xs text-gray-400 capitalize">{status.state}</span>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          <button
            onClick={() => setTab('chat')}
            className={`px-2.5 py-1 text-xs transition-colors ${tab === 'chat' ? 'text-black' : 'text-gray-400 hover:text-white'}`}
            style={tab === 'chat' ? { backgroundColor: theme } : {}}
          >
            Chat
          </button>
          <button
            onClick={() => setTab('customize')}
            className={`px-2.5 py-1 text-xs transition-colors ${tab === 'customize' ? 'text-black' : 'text-gray-400 hover:text-white'}`}
            style={tab === 'customize' ? { backgroundColor: theme } : {}}
          >
            ✦ Style
          </button>
        </div>
      </div>

      {/* Tab content */}
      {tab === 'chat' ? (
        <ChatTab
          status={status}
          streamedText={streamedText}
          listening={listening}
          textInput={textInput}
          theme={theme}
          orbName={orbName}
          setTextInput={setTextInput}
          onPress={handlePress}
          onRelease={handleRelease}
          onTextSubmit={handleTextSubmit}
        />
      ) : (
        <CustomizeTab config={orbCfg} onSave={handleSaveConfig} />
      )}
    </div>
  )
}
