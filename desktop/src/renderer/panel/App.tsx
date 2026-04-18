/**
 * Panel UI — two tabs:
 *  • Chat     — conversation thread, voice via Web Speech API, text input
 *  • Settings — orb name/theme/personality + proxy URL
 */

import React, { useEffect, useRef, useState } from 'react'
import type { CompanionStatus, OrbConfig } from '../../shared/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UIMessage {
  id:      string
  role:    'user' | 'assistant'
  content: string
}

type Tab = 'chat' | 'settings'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DOT_COLOR: Record<string, string> = {
  idle:       '#6b7280',
  listening:  '#10b981',
  processing: '#3b82f6',
  responding: '#f59e0b',
}

function uid(): string { return Math.random().toString(36).slice(2) }

function Dot({ state, theme }: { state: string; theme: string }): React.ReactElement {
  const pulse = state === 'listening' || state === 'responding'
  const color = (state === 'listening' || state === 'responding') ? theme : (DOT_COLOR[state] ?? '#6b7280')
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${pulse ? 'animate-pulse' : ''}`}
      style={{ backgroundColor: color }}
    />
  )
}

// ---------------------------------------------------------------------------
// Markdown renderer — zero-dependency inline implementation
// ---------------------------------------------------------------------------

/** Render inline spans: **bold**, *italic*, `code` */
function renderInline(text: string, theme: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  // Combined regex: bold, italic, inline-code
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`/g
  let lastIdx = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index))
    if (match[1] != null) {
      parts.push(<strong key={key++} className="font-semibold text-white">{match[1]}</strong>)
    } else if (match[2] != null) {
      parts.push(<em key={key++} className="italic text-gray-300">{match[2]}</em>)
    } else if (match[3] != null) {
      parts.push(
        <code key={key++} className="rounded px-1 py-0.5 text-xs font-mono"
          style={{ backgroundColor: theme + '22', color: theme }}>{match[3]}</code>
      )
    }
    lastIdx = match.index + match[0].length
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx))
  return parts.length === 0 ? '' : parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : <>{parts}</>
}

function MarkdownContent({ content, theme }: { content: string; theme: string }): React.ReactElement {
  const elements: React.ReactElement[] = []
  const lines = content.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // ── Fenced code block ─────────────────────────────────────────────
    if (line.startsWith('```')) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++ }
      elements.push(
        <pre key={i} className="bg-[#0d1117] rounded-md px-3 py-2 overflow-x-auto text-xs font-mono mt-1 mb-1 border border-white/10">
          <code>{codeLines.join('\n')}</code>
        </pre>
      )
      i++; continue
    }

    // ── Headings ──────────────────────────────────────────────────────
    if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="text-xs font-semibold mt-1 text-gray-200">{renderInline(line.slice(4), theme)}</h3>)
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-sm font-semibold mt-1 mb-0.5 text-white">{renderInline(line.slice(3), theme)}</h2>)
    } else if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="text-sm font-bold mt-1 mb-0.5 text-white">{renderInline(line.slice(2), theme)}</h1>)
    }

    // ── Bullet list ───────────────────────────────────────────────────
    else if (/^[-*] /.test(line)) {
      const items: React.ReactElement[] = []
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(<li key={i} className="leading-relaxed">{renderInline(lines[i].slice(2), theme)}</li>)
        i++
      }
      elements.push(<ul key={`ul-${i}`} className="list-disc pl-4 space-y-0.5 my-1">{items}</ul>)
      continue
    }

    // ── Numbered list ─────────────────────────────────────────────────
    else if (/^\d+\. /.test(line)) {
      const items: React.ReactElement[] = []
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(<li key={i} className="leading-relaxed">{renderInline(lines[i].replace(/^\d+\. /, ''), theme)}</li>)
        i++
      }
      elements.push(<ol key={`ol-${i}`} className="list-decimal pl-4 space-y-0.5 my-1">{items}</ol>)
      continue
    }

    // ── Blockquote ────────────────────────────────────────────────────
    else if (line.startsWith('> ')) {
      elements.push(
        <blockquote key={i} className="border-l-2 pl-3 my-1 text-gray-400 italic"
          style={{ borderColor: theme + '66' }}>
          {renderInline(line.slice(2), theme)}
        </blockquote>
      )
    }

    // ── Horizontal rule ───────────────────────────────────────────────
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      elements.push(<hr key={i} className="border-white/10 my-2" />)
    }

    // ── Empty line → slight gap ───────────────────────────────────────
    else if (line.trim() === '') {
      if (elements.length > 0) elements.push(<div key={i} className="h-1" />)
    }

    // ── Paragraph ─────────────────────────────────────────────────────
    else {
      elements.push(<p key={i} className="my-0.5 leading-relaxed">{renderInline(line, theme)}</p>)
    }

    i++
  }

  return <>{elements}</>
}

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

function CopyButton({ text, theme }: { text: string; theme: string }): React.ReactElement {
  const [copied, setCopied] = useState(false)
  function handleCopy(): void {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }
  return (
    <button
      onClick={handleCopy}
      title="Copy response"
      className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
      style={{ color: copied ? theme : '#6b7280' }}
    >
      {copied ? (
        <>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
          Copied
        </>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
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
        ${(disabled && !listening) ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : ''}
        ${(!disabled && !listening) ? 'bg-gray-700 text-white hover:bg-gray-600 active:scale-[0.98]' : ''}
        ${listening ? 'text-black scale-[0.98]' : ''}
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
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
      {listening ? 'Listening… (release to send)' : 'Hold to speak  Ctrl+Shift+Space'}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Chat tab
// ---------------------------------------------------------------------------

function ChatTab({
  messages, streaming, liveTranscript, transcribing, status, listening, textInput, theme, orbName,
  setTextInput, onPress, onRelease, onTextSubmit, onClear,
}: {
  messages:       UIMessage[]
  streaming:      string
  liveTranscript: string
  transcribing:   boolean
  status:         CompanionStatus
  listening:      boolean
  textInput:      string
  theme:          string
  orbName:        string
  setTextInput:   (v: string) => void
  onPress:        () => void
  onRelease:      () => void
  onTextSubmit:   (e: React.FormEvent) => void
  onClear:        () => void
}): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null)
  const { state, error } = status
  const isIdle = state === 'idle'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  return (
    <>
      {/* Message thread */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0">

        {/* Empty state */}
        {messages.length === 0 && !streaming && !error && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm space-y-2 pb-4">
            <p className="text-3xl">🎙️</p>
            <p>Hold <kbd className="px-1.5 py-0.5 rounded bg-gray-700 text-xs font-mono">Ctrl+Shift+Space</kbd> and speak</p>
            <p className="text-xs opacity-60">or type below — {orbName} is ready</p>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">
            {error}
            <button onClick={onClear} className="mt-2 w-full py-1.5 rounded bg-red-500/20 text-red-400 text-xs hover:bg-red-500/30">
              Clear
            </button>
          </div>
        )}

        {/* Conversation history */}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex group ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[88%] rounded-xl px-3 py-2 text-sm leading-relaxed relative ${
                msg.role === 'user'
                  ? 'text-white rounded-br-sm'
                  : 'bg-[#1a2130] text-gray-100 rounded-bl-sm'
              }`}
              style={msg.role === 'user' ? { backgroundColor: theme + 'cc' } : undefined}
            >
              {msg.role === 'assistant'
                ? <MarkdownContent content={msg.content} theme={theme} />
                : msg.content}
              {msg.role === 'assistant' && (
                <div className="mt-1 flex justify-end">
                  <CopyButton text={msg.content} theme={theme} />
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Streaming AI message */}
        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[88%] bg-[#1a2130] rounded-xl rounded-bl-sm px-3 py-2 text-sm leading-relaxed text-gray-100">
              <MarkdownContent content={streaming} theme={theme} />
              <span className="animate-pulse ml-0.5">▋</span>
            </div>
          </div>
        )}

        {/* Processing spinner (before first chunk) */}
        {state === 'processing' && !streaming && (
          <div className="flex justify-start">
            <div className="bg-[#1a2130] rounded-xl rounded-bl-sm px-3 py-2 flex items-center gap-2 text-sm text-gray-400">
              <svg className="animate-spin w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity="0.2" />
                <path d="M21 12a9 9 0 00-9-9" />
              </svg>
              Thinking…
            </div>
          </div>
        )}

        {/* Live transcript (Web Speech interim) */}
        {liveTranscript && (
          <div className="flex justify-end">
            <div
              className="max-w-[88%] rounded-xl rounded-br-sm px-3 py-2 text-sm text-white/70 italic border border-dashed"
              style={{ borderColor: theme + '66', backgroundColor: theme + '15' }}
            >
              🎤 {liveTranscript}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Clear history button (only when there's something to clear) */}
      {messages.length > 0 && (
        <div className="px-3 pb-1">
          <button
            onClick={onClear}
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            Clear conversation
          </button>
        </div>
      )}

      {/* Text input */}
      <div className="px-3 pt-1.5 pb-1.5 border-t border-white/10">
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
              focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors
            "
            onFocus={(e) => { e.currentTarget.style.borderColor = theme + '99' }}
            onBlur={(e)  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
          />
          <button
            type="submit"
            disabled={!isIdle || !textInput.trim()}
            className="px-3 py-2 rounded-lg text-white hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 flex-shrink-0"
            style={{ backgroundColor: theme }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </div>

      {/* PTT button */}
      <div className="px-3 pb-3 pt-0.5">
        <PttButton
          listening={listening}
          disabled={(!isIdle && !listening) || transcribing}
          theme={theme}
          onPress={onPress}
          onRelease={onRelease}
        />
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Settings tab — orb customisation + proxy URL
// ---------------------------------------------------------------------------

const THEMES = [
  { label: 'Emerald', hex: '#10b981' },
  { label: 'Sky',     hex: '#38bdf8' },
  { label: 'Violet',  hex: '#8b5cf6' },
  { label: 'Rose',    hex: '#f43f5e' },
  { label: 'Amber',   hex: '#f59e0b' },
  { label: 'Slate',   hex: '#94a3b8' },
]

const PERSONALITIES: { value: OrbConfig['personality']; label: string; desc: string }[] = [
  { value: 'friendly',     label: 'Friendly',    desc: 'Warm and helpful' },
  { value: 'professional', label: 'Professional', desc: 'Precise and formal' },
  { value: 'playful',      label: 'Playful',      desc: 'Fun and enthusiastic' },
  { value: 'concise',      label: 'Concise',      desc: 'One sentence max' },
]

function SettingsTab({
  config, proxyUrl, initialOrgId, onSaveConfig, onSaveProxy,
}: {
  config:        OrbConfig
  proxyUrl:      string
  initialOrgId:  string
  onSaveConfig:  (cfg: Partial<OrbConfig>) => void
  onSaveProxy:   (url: string) => void
}): React.ReactElement {
  const [name,  setName]  = useState(config.name)
  const [proxy, setProxy] = useState(proxyUrl)
  const [orgId, setOrgId] = useState(initialOrgId)

  useEffect(() => { setName(config.name) }, [config.name])
  useEffect(() => { setProxy(proxyUrl) },   [proxyUrl])
  useEffect(() => { setOrgId(initialOrgId) }, [initialOrgId])

  function handleNameBlur(e: React.FocusEvent<HTMLInputElement>): void {
    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
    const v = name.trim() || 'Mwongozo'
    setName(v)
    if (v !== config.name) onSaveConfig({ name: v })
  }

  function handleProxyBlur(e: React.FocusEvent<HTMLInputElement>): void {
    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
    const v = proxy.trim() || 'http://localhost:8787'
    setProxy(v)
    if (v !== proxyUrl) onSaveProxy(v)
  }

  const inputClass = `
    w-full bg-[#161b22] border border-white/10 rounded-lg px-3 py-2
    text-sm text-white focus:outline-none transition-colors
  `
  const focusHandler = (e: React.FocusEvent<HTMLInputElement>): void => {
    e.currentTarget.style.borderColor = config.theme + '99'
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">

      {/* Name */}
      <section>
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Companion name
        </label>
        <input
          type="text" value={name} maxLength={24}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          className={inputClass}
          onFocus={focusHandler}
          onBlur={handleNameBlur}
        />
      </section>

      {/* Colour */}
      <section>
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Colour theme
        </label>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map((t) => (
            <button
              key={t.hex}
              onClick={() => onSaveConfig({ theme: t.hex })}
              className={`
                flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all
                ${config.theme === t.hex ? 'border-white/40 bg-white/8' : 'border-white/10 hover:border-white/25 bg-white/4'}
              `}
            >
              <span
                className="w-4 h-4 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: t.hex,
                  boxShadow: config.theme === t.hex ? `0 0 0 2px #0d1117, 0 0 0 4px ${t.hex}` : 'none',
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
              onClick={() => onSaveConfig({ personality: p.value })}
              className={`
                w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-left transition-all
                ${config.personality === p.value ? 'border-white/40 bg-white/8' : 'border-white/10 hover:border-white/25 bg-white/4'}
              `}
            >
              <div>
                <p className="text-sm text-white">{p.label}</p>
                <p className="text-xs text-gray-500">{p.desc}</p>
              </div>
              {config.personality === p.value && (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: config.theme }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Proxy URL */}
      <section>
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Proxy server URL
        </label>
        <input
          type="text" value={proxy}
          onChange={(e) => setProxy(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          placeholder="http://localhost:8787"
          className={inputClass}
          onFocus={focusHandler}
          onBlur={handleProxyBlur}
        />
        <p className="text-xs text-gray-600 mt-1.5">
          Your AI + TTS proxy server. API keys live there, never here.
        </p>
      </section>

      {/* Organisation (white-labeling) */}
      <section>
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Organisation
        </label>
        <select
          value={orgId}
          onChange={(e) => {
            setOrgId(e.target.value)
            window.api.setOrgId(e.target.value)
          }}
          className={inputClass}
          style={{ cursor: 'pointer' }}
        >
          <option value="">None (generic assistant)</option>
          <option value="tra">TRA — Tanzania Revenue Authority</option>
          <option value="brela">BRELA — Business Registrations</option>
          <option value="crdb">CRDB Bank</option>
          <option value="nmb">NMB Bank</option>
        </select>
        <p className="text-xs text-gray-600 mt-1.5">
          Loads organisation-specific knowledge and branding from the proxy.
        </p>
      </section>

    </div>
  )
}

// ---------------------------------------------------------------------------
// Main app
// ---------------------------------------------------------------------------

export function App(): React.ReactElement {
  const [status, setStatus] = useState<CompanionStatus>({
    state: 'idle', responseText: '', transcript: '', error: '',
  })
  const [messages,      setMessages]      = useState<UIMessage[]>([])
  const [streaming,     setStreaming]      = useState('')
  const [liveTranscript,setLiveTranscript] = useState('')
  const [listening,     setListening]      = useState(false)
  const [textInput,     setTextInput]      = useState('')
  const [tab,           setTab]            = useState<Tab>('chat')
  const [orbCfg,        setOrbCfg]         = useState<OrbConfig>({ name: 'Mwongozo', theme: '#10b981', personality: 'friendly', wakeWordEnabled: false })
  const [proxyUrl,      setProxyUrlState]  = useState('http://localhost:8787')
  const [orgIdState,    setOrgIdState]     = useState('')

  const [transcribing,  setTranscribing]  = useState(false)

  const streamingRef      = useRef('')
  const mediaRecorderRef  = useRef<MediaRecorder | null>(null)
  const audioChunksRef    = useRef<Blob[]>([])
  const transcribingRef   = useRef(false)   // mirrors `transcribing` for stale-closure safety
  const orbCfgRef          = useRef(orbCfg)  // always-current config inside callbacks
  const statusRef          = useRef(status)

  // ── bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    window.api.getStatus().then(setStatus)
    window.api.getOrbConfig().then(setOrbCfg)
    window.api.getProxyUrl().then(setProxyUrlState)
    window.api.getOrgId?.().then(setOrgIdState)

    // Restore persisted conversation history
    window.api.getHistory().then((history) => {
      if (history.length > 0) {
        setMessages(history.map((m) => ({ id: uid(), role: m.role, content: m.content })))
      }
    })

    const subs = [
      window.api.onStatus((s) => {
        setStatus(s)
        setListening(s.state === 'listening')
      }),
      window.api.onHotkeyPress(() => {
        setListening(true)
        startRecording()
      }),
      window.api.onHotkeyRelease(() => {
        setListening(false)
        stopRecording()
      }),
      window.api.onClaudeChunk((chunk) => {
        streamingRef.current += chunk
        setStreaming(streamingRef.current)
      }),
      window.api.onClaudeDone(() => {
        const final = streamingRef.current
        if (final) {
          setMessages((prev) => [...prev, { id: uid(), role: 'assistant', content: final }])
        }
        streamingRef.current = ''
        setStreaming('')
      }),
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

  // Keep always-current refs in sync for use inside callbacks
  useEffect(() => { orbCfgRef.current = orbCfg }, [orbCfg])
  useEffect(() => { statusRef.current = status  }, [status])

  // ── MediaRecorder-based voice input ───────────────────────────────────────

  /** Convert a Blob to a bare base64 string (no data-URL prefix). */
  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload  = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  async function startRecording(): Promise<void> {
    // Don't start a new recording if one is already running or we're transcribing
    if (mediaRecorderRef.current || transcribingRef.current) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const rec = new MediaRecorder(stream, { mimeType })
      audioChunksRef.current = []

      rec.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      rec.onstop = async () => {
        // Release microphone immediately
        stream.getTracks().forEach((t) => t.stop())
        mediaRecorderRef.current = null

        const blob = new Blob(audioChunksRef.current, { type: mimeType })
        audioChunksRef.current = []

        // Ignore suspiciously small blobs (< 1 KB = ~silence / accidental tap)
        if (blob.size < 1024) { setLiveTranscript(''); return }

        try {
          transcribingRef.current = true
          setTranscribing(true)
          setLiveTranscript('Transcribing…')
          const b64 = await blobToBase64(blob)
          const transcript = await window.api.transcribeAudio(b64)
          setLiveTranscript('')
          if (transcript.trim()) submitVoiceQuery(transcript.trim())
        } catch (err) {
          console.error('[panel] Transcription failed:', err)
          setLiveTranscript('')
        } finally {
          transcribingRef.current = false
          setTranscribing(false)
        }
      }

      rec.start()
      mediaRecorderRef.current = rec
    } catch (err) {
      console.error('[panel] Mic access failed:', err)
      setListening(false)
    }
  }

  function stopRecording(): void {
    const rec = mediaRecorderRef.current
    if (rec && rec.state === 'recording') {
      rec.stop() // triggers onstop asynchronously
    } else {
      mediaRecorderRef.current = null
    }
  }

  function submitVoiceQuery(transcript: string): void {
    setMessages((prev) => [...prev, { id: uid(), role: 'user', content: transcript }])
    streamingRef.current = ''
    setStreaming('')
    window.api.submitQuery(transcript)
  }

  // ── PTT button handlers ────────────────────────────────────────────────────

  function handlePress(): void {
    if (status.state !== 'idle' || transcribingRef.current) return
    setListening(true)
    startRecording()
  }

  function handleRelease(): void {
    setListening(false)
    stopRecording()
  }

  // ── Text submit ────────────────────────────────────────────────────────────

  async function handleTextSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const q = textInput.trim()
    if (!q || status.state !== 'idle') return
    setTextInput('')
    setMessages((prev) => [...prev, { id: uid(), role: 'user', content: q }])
    streamingRef.current = ''
    setStreaming('')
    await window.api.submitQuery(q)
  }

  // ── Clear conversation ─────────────────────────────────────────────────────

  function handleClear(): void {
    setMessages([])
    setStreaming('')
    streamingRef.current = ''
    window.api.reset()
  }

  // ── Config save ────────────────────────────────────────────────────────────

  async function handleSaveConfig(cfg: Partial<OrbConfig>): Promise<void> {
    setOrbCfg((prev) => ({ ...prev, ...cfg }))
    await window.api.setOrbConfig(cfg)
  }

  async function handleSaveProxy(url: string): Promise<void> {
    setProxyUrlState(url)
    await window.api.setProxyUrl(url)
  }

  // ── Audio helpers ──────────────────────────────────────────────────────────

  async function playAudio(base64: string): Promise<void> {
    const ctx   = new AudioContext()
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const buf   = await ctx.decodeAudioData(bytes.buffer)
    const src   = ctx.createBufferSource()
    src.buffer  = buf
    src.connect(ctx.destination)
    return new Promise((res) => { src.onended = () => res(); src.start() })
  }

  async function webSpeech(text: string): Promise<void> {
    return new Promise((res) => {
      if (!window.speechSynthesis) { res(); return }
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.rate  = 0.95
      u.onend  = () => res()
      u.onerror = () => res()
      window.speechSynthesis.speak(u)
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const { theme, name: orbName } = orbCfg

  return (
    <div className="h-screen flex flex-col bg-[#0d1117] text-white select-none" style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/10 flex-shrink-0">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-black font-bold text-sm flex-shrink-0"
          style={{ backgroundColor: theme }}
        >
          {orbName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate leading-tight">{orbName}</p>
          <div className="flex items-center gap-1.5">
            <Dot state={status.state} theme={theme} />
            <span className="text-xs text-gray-500 capitalize">{status.state}</span>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex rounded-lg overflow-hidden border border-white/10 flex-shrink-0">
          {(['chat', 'settings'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-2.5 py-1 text-xs transition-colors capitalize ${tab === t ? 'text-black' : 'text-gray-400 hover:text-white'}`}
              style={tab === t ? { backgroundColor: theme } : {}}
            >
              {t === 'settings' ? '⚙' : 'Chat'}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {tab === 'chat' ? (
        <ChatTab
          messages={messages}
          streaming={streaming}
          liveTranscript={liveTranscript}
          transcribing={transcribing}
          status={status}
          listening={listening}
          textInput={textInput}
          theme={theme}
          orbName={orbName}
          setTextInput={setTextInput}
          onPress={handlePress}
          onRelease={handleRelease}
          onTextSubmit={handleTextSubmit}
          onClear={handleClear}
        />
      ) : (
        <SettingsTab
          config={orbCfg}
          proxyUrl={proxyUrl}
          initialOrgId={orgIdState}
          onSaveConfig={handleSaveConfig}
          onSaveProxy={handleSaveProxy}
        />
      )}
    </div>
  )
}
