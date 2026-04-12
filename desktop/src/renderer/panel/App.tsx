/**
 * PanelApp — the tray panel UI.
 *
 * Ported from CompanionPanelView.swift (Clicky).
 *
 * All IPC goes through window.electronAPI (contextBridge).
 * No direct window.ipcRenderer access — that is never exposed.
 */

import React, { useEffect, useRef, useState } from 'react'
import { DS } from '../styles/design-tokens'
import type { CompanionStatus, GuidanceResult, OrgProfile } from '../../shared/types'

// ---------------------------------------------------------------------------
// State indicator dot
// ---------------------------------------------------------------------------

function StateIndicator({ state }: { state: string }): React.ReactElement {
  const color = DS.stateColors[state] ?? DS.colors.accent
  const isPulsing = state === 'listening' || state === 'speaking'
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${isPulsing ? 'animate-pulse-slow' : ''}`}
      style={{ backgroundColor: color }}
    />
  )
}

// ---------------------------------------------------------------------------
// Push-to-talk button
// ---------------------------------------------------------------------------

interface PttButtonProps {
  isListening: boolean
  isDisabled: boolean
  onPress: () => void
  onRelease: () => void
}

function PttButton({ isListening, isDisabled, onPress, onRelease }: PttButtonProps): React.ReactElement {
  return (
    <button
      className={`
        w-full py-3 px-4 rounded-lg font-medium text-sm transition-all duration-150
        flex items-center justify-center gap-2
        ${isListening
          ? 'bg-accent text-bg shadow-lg scale-[0.98]'
          : isDisabled
            ? 'bg-surface2 text-muted cursor-not-allowed opacity-50'
            : 'bg-surface2 text-white hover:bg-opacity-80 active:scale-[0.98]'
        }
      `}
      onMouseDown={isDisabled ? undefined : onPress}
      onMouseUp={isDisabled ? undefined : onRelease}
      onTouchStart={isDisabled ? undefined : onPress}
      onTouchEnd={isDisabled ? undefined : onRelease}
      disabled={isDisabled}
    >
      <MicIcon active={isListening} />
      {isListening
        ? 'Sikilizando… (achia)'
        : 'Shikilia kusema (Ctrl+Shift+Space)'}
    </button>
  )
}

function MicIcon({ active }: { active: boolean }): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
      {active && <circle cx="12" cy="7" r="1.5" fill="currentColor" className="animate-ping" />}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Guidance response card
// ---------------------------------------------------------------------------

function GuidanceCard({ guidance }: { guidance: GuidanceResult }): React.ReactElement {
  return (
    <div className="bg-surface rounded-lg p-3 text-sm animate-slide-up selectable">
      <p className="text-white leading-relaxed">{guidance.text}</p>
      {guidance.points.length > 0 && (
        <div className="mt-2 flex items-center gap-1 text-xs text-muted">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
          </svg>
          Inaonyesha eneo la kitufe
        </div>
      )}
      <div className="mt-2 text-xs opacity-40">
        via {guidance.modelUsed === 'qwen2.5-vl' ? 'Qwen2.5-VL' : guidance.modelUsed === 'claude-sonnet' ? 'Claude Sonnet' : 'demo'}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Error card with reset button
// ---------------------------------------------------------------------------

function ErrorCard({ message, onReset }: { message: string; onReset: () => void }): React.ReactElement {
  return (
    <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-sm animate-fade-in">
      <div className="flex items-start gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" className="flex-shrink-0 mt-0.5">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <p className="text-danger leading-relaxed flex-1">{message || 'Hitilafu imetokea.'}</p>
      </div>
      <button
        onClick={onReset}
        className="mt-3 w-full py-1.5 px-3 rounded-md text-xs font-medium bg-danger/20 text-danger hover:bg-danger/30 transition-colors"
      >
        Jaribu tena / Retry
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Flow progress bar
// ---------------------------------------------------------------------------

function FlowProgress({ flowId, currentStep, totalSteps }: {
  flowId: string
  currentStep: number
  totalSteps: number
}): React.ReactElement {
  const progress = totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0
  const labels: Record<string, string> = {
    'tra-vat-filing': 'TRA VAT',
    'tra-paye': 'TRA PAYE',
    'brela-registration': 'BRELA',
    'zssf-contribution': 'ZSSF',
    'nhif-registration': 'NHIF',
  }
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted">
        <span>{labels[flowId] ?? flowId}</span>
        <span>Hatua {currentStep}/{totalSteps}</span>
      </div>
      <div className="w-full h-1.5 bg-surface2 rounded-pill overflow-hidden">
        <div
          className="h-full bg-accent rounded-pill transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main app component
// ---------------------------------------------------------------------------

export function PanelApp(): React.ReactElement {
  const [profile, setProfile] = useState<OrgProfile | null>(null)
  const [status, setStatus] = useState<CompanionStatus | null>(null)
  const [lastGuidance, setLastGuidance] = useState<GuidanceResult | null>(null)
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)

  // ---------------------------------------------------------------------------
  // Mount: load profile, status, subscribe to all IPC events
  // ---------------------------------------------------------------------------

  useEffect(() => {
    window.electronAPI.getProfile().then(setProfile)
    window.electronAPI.getCompanionStatus().then(setStatus)

    const unsubs = [
      window.electronAPI.onStateChange((s) => {
        setStatus(s)
        setIsListening(s.state === 'listening')
        if (s.state === 'error') {
          setErrorMessage(s.errorMessage ?? 'Hitilafu imetokea. / An error occurred.')
        } else {
          setErrorMessage('')
        }
      }),

      window.electronAPI.onGuidanceResult((result) => setLastGuidance(result)),

      window.electronAPI.onTranscriptionResult((text) => setTranscript(text)),

      // Hotkey events from main (when user uses keyboard shortcut)
      window.electronAPI.onHotkeyPress(() => {
        setIsListening(true)
        startMicCapture()
      }),
      window.electronAPI.onHotkeyRelease(() => {
        setIsListening(false)
        stopMicCapture()
      }),

      // TTS: main sends MP3 buffer, we play it via Web Audio API
      window.electronAPI.onPlayAudio((base64mp3) => {
        playBase64Audio(base64mp3)
          .catch((err) => console.error('[panel] Web Audio playback failed:', err))
          .finally(() => window.electronAPI.notifyAudioDone())
      }),

      // TTS: main asks us to use the browser's built-in speech synthesis
      window.electronAPI.onWebSpeech(({ text, language }) => {
        speakViaWebSpeechAPI(text, language)
          .finally(() => window.electronAPI.notifyWebSpeechDone())
      }),
    ]

    return () => unsubs.forEach((unsub) => unsub())
  }, [])

  // ---------------------------------------------------------------------------
  // Mic capture (Web Audio API — runs in renderer, sends chunks to main)
  // ---------------------------------------------------------------------------

  async function startMicCapture(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size === 0) return
        const reader = new FileReader()
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1]
          window.electronAPI.sendAudioChunk(base64)
        }
        reader.readAsDataURL(e.data)
      }

      recorder.start(250)
    } catch (err) {
      console.error('[panel] Mic access denied:', err)
      setErrorMessage('Ruhusa ya maikrofoni ilikataliwa. / Microphone permission denied.')
    }
  }

  function stopMicCapture(): void {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
      recorder.stream.getTracks().forEach((t) => t.stop())
      window.electronAPI.sendAudioStop()
    }
    mediaRecorderRef.current = null
  }

  // ---------------------------------------------------------------------------
  // PTT button handlers (click alternative to keyboard shortcut)
  // ---------------------------------------------------------------------------

  function handlePttPress(): void {
    if (status?.state !== 'idle') return
    setIsListening(true)
    startMicCapture()
  }

  function handlePttRelease(): void {
    setIsListening(false)
    stopMicCapture()
  }

  // ---------------------------------------------------------------------------
  // Error recovery
  // ---------------------------------------------------------------------------

  async function handleReset(): Promise<void> {
    stopMicCapture()
    setIsListening(false)
    setErrorMessage('')
    await window.electronAPI.resetCompanion()
  }

  // ---------------------------------------------------------------------------
  // TTS: Web Audio API playback (for edge-tts / Piper MP3 buffers)
  // ---------------------------------------------------------------------------

  async function playBase64Audio(base64: string): Promise<void> {
    const audioCtx = new AudioContext()
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer)
    const source = audioCtx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(audioCtx.destination)
    return new Promise((resolve) => {
      source.onended = () => resolve()
      source.start()
    })
  }

  // ---------------------------------------------------------------------------
  // TTS: Web Speech API fallback (no server needed, built into Windows)
  // ---------------------------------------------------------------------------

  async function speakViaWebSpeechAPI(text: string, language: string): Promise<void> {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) { resolve(); return }

      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = language === 'sw' ? 'sw-TZ' : 'en-GB'
      utterance.rate = 0.95

      // Pick the best available Swahili voice if present
      const voices = window.speechSynthesis.getVoices()
      const swVoice = voices.find((v) => v.lang.startsWith('sw') || v.name.includes('Daudi') || v.name.includes('Zuri'))
      if (swVoice && language === 'sw') utterance.voice = swVoice

      utterance.onend = () => resolve()
      utterance.onerror = () => resolve()
      window.speechSynthesis.speak(utterance)
    })
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const lang = profile?.language ?? 'sw'
  const state = status?.state ?? 'idle'
  const stateLabel = lang === 'sw' ? DS.stateLabels_sw[state] : DS.stateLabels_en[state]
  const isPttDisabled = state !== 'idle' && state !== 'error' && !isListening

  return (
    <div className="h-screen flex flex-col bg-bg text-white select-none overflow-hidden" style={{ fontFamily: DS.font.ui }}>

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/8">
        {profile?.logoUrl
          ? <img src={profile.logoUrl} alt="" className="w-7 h-7 rounded object-contain" />
          : <div className="w-7 h-7 rounded bg-accent flex items-center justify-center text-bg text-xs font-bold flex-shrink-0">M</div>
        }
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{profile?.orgName ?? 'Mwongozo'}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <StateIndicator state={state} />
            <span className="text-xs text-muted">{stateLabel}</span>
          </div>
        </div>
      </div>

      {/* Flow progress */}
      {status?.activeFlowId && status.activeFlowStep !== undefined && (
        <div className="px-4 py-3 border-b border-white/8">
          <FlowProgress
            flowId={status.activeFlowId}
            currentStep={status.activeFlowStep}
            totalSteps={5}
          />
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">

        {/* Error state */}
        {state === 'error' && (
          <ErrorCard message={errorMessage} onReset={handleReset} />
        )}

        {/* Transcript */}
        {transcript && state !== 'error' && (
          <div className="text-xs text-muted italic border-l-2 border-accent/40 pl-2 selectable">
            "{transcript}"
          </div>
        )}

        {/* AI guidance or empty state */}
        {lastGuidance && state !== 'error'
          ? <GuidanceCard guidance={lastGuidance} />
          : state === 'idle' && !lastGuidance && (
            <div className="text-center py-8 text-muted text-sm space-y-2">
              <div className="text-3xl">🎙️</div>
              <p>Shikilia <kbd className="px-1.5 py-0.5 rounded text-xs bg-surface2 font-mono">Ctrl+Shift+Space</kbd> kusema</p>
              <p className="text-xs opacity-60">au bonyeza kitufe hapa chini</p>
            </div>
          )
        }

        {/* Processing spinner */}
        {(state === 'transcribing' || state === 'processing') && (
          <div className="flex items-center gap-2 text-sm text-muted animate-fade-in">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity="0.3" />
              <path d="M21 12a9 9 0 00-9-9" />
            </svg>
            <span>{state === 'transcribing' ? 'Inabadilisha sauti…' : 'Inafikiria…'}</span>
          </div>
        )}
      </div>

      {/* PTT button */}
      <div className="px-4 pb-4 pt-2 border-t border-white/8">
        <PttButton
          isListening={isListening}
          isDisabled={isPttDisabled}
          onPress={handlePttPress}
          onRelease={handlePttRelease}
        />
      </div>
    </div>
  )
}
