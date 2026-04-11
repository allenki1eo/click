/**
 * PanelApp — the tray panel UI.
 *
 * Ported from CompanionPanelView.swift (Clicky).
 *
 * Shows:
 *  - Org name and logo
 *  - Current companion state with animated indicator
 *  - Push-to-talk button (click alternative to hotkey)
 *  - Last AI response text
 *  - Current flow step progress
 *  - Mic capture (sends WAV chunks to main process via IPC)
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
      className={`inline-block w-2 h-2 rounded-full ${isPulsing ? 'animate-pulse-slow' : ''}`}
      style={{ backgroundColor: color }}
    />
  )
}

// ---------------------------------------------------------------------------
// Push-to-talk button
// ---------------------------------------------------------------------------

interface PttButtonProps {
  isListening: boolean
  onPress: () => void
  onRelease: () => void
}

function PttButton({ isListening, onPress, onRelease }: PttButtonProps): React.ReactElement {
  return (
    <button
      className={`
        w-full py-3 px-4 rounded-lg font-medium text-sm transition-all duration-150
        flex items-center justify-center gap-2
        ${isListening
          ? 'bg-accent text-bg shadow-lg scale-[0.98]'
          : 'bg-surface2 text-white hover:bg-opacity-80 active:scale-[0.98]'
        }
      `}
      onMouseDown={onPress}
      onMouseUp={onRelease}
      onTouchStart={onPress}
      onTouchEnd={onRelease}
    >
      <MicIcon active={isListening} />
      {isListening ? 'Sikilizando... (achia kuacha)' : 'Shikilia kusema (Ctrl+Shift)'}
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
      {active && <circle cx="12" cy="7" r="1" fill="currentColor" className="animate-ping" />}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Guidance response card
// ---------------------------------------------------------------------------

function GuidanceCard({ guidance }: { guidance: GuidanceResult }): React.ReactElement {
  return (
    <div className="bg-surface rounded-lg p-3 text-sm animate-slide-up">
      <p className="text-white leading-relaxed">{guidance.text}</p>
      {guidance.points.length > 0 && (
        <div className="mt-2 flex items-center gap-1 text-xs text-muted">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
          </svg>
          Inaonyesha eneo la kitufe
        </div>
      )}
      <div className="mt-2 text-xs text-muted opacity-60">
        {guidance.modelUsed === 'qwen2.5-vl' ? 'Qwen2.5-VL' : 'Claude Sonnet'}
      </div>
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
  const flowLabels: Record<string, string> = {
    'tra-vat-filing': 'TRA VAT',
    'tra-paye': 'TRA PAYE',
    'brela-registration': 'BRELA',
    'zssf-contribution': 'ZSSF',
    'nhif-registration': 'NHIF'
  }

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted">
        <span>{flowLabels[flowId] ?? flowId}</span>
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

  // Mic recording state
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)

  // ---------------------------------------------------------------------------
  // Load profile and companion status on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    window.electronAPI.getProfile().then(setProfile)
    window.electronAPI.getCompanionStatus().then(setStatus)

    const unsubState = window.electronAPI.onStateChange((newStatus) => {
      setStatus(newStatus)
      setIsListening(newStatus.state === 'listening')
    })

    const unsubGuidance = window.electronAPI.onGuidanceResult((result) => {
      setLastGuidance(result)
    })

    const unsubTranscript = window.electronAPI.onTranscriptionResult((text) => {
      setTranscript(text)
    })

    const unsubPress = window.electronAPI.onHotkeyPress(() => {
      setIsListening(true)
      startMicCapture()
    })

    const unsubRelease = window.electronAPI.onHotkeyRelease(() => {
      setIsListening(false)
      stopMicCapture()
    })

    // Handle TTS audio playback in this window
    const handlePlayAudio = (_: unknown, base64Audio: string): void => {
      playBase64Audio(base64Audio).then(() => {
        // Notify main process that playback finished
        window.ipcRenderer?.send('TTS:AUDIO_DONE')
      })
    }
    window.ipcRenderer?.on('TTS:PLAY_AUDIO', handlePlayAudio)

    return () => {
      unsubState()
      unsubGuidance()
      unsubTranscript()
      unsubPress()
      unsubRelease()
      window.ipcRenderer?.removeListener('TTS:PLAY_AUDIO', handlePlayAudio)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Mic capture (Web Audio API)
  // ---------------------------------------------------------------------------

  async function startMicCapture(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          const reader = new FileReader()
          reader.onloadend = () => {
            const base64 = (reader.result as string).split(',')[1]
            window.electronAPI.sendAudioChunk(base64)
          }
          reader.readAsDataURL(e.data)
        }
      }

      recorder.start(250) // Send chunk every 250ms
    } catch (err) {
      console.error('[PanelApp] Mic access denied:', err)
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
  // PTT button handlers
  // ---------------------------------------------------------------------------

  function handlePttPress(): void {
    window.electronAPI.getCompanionStatus().then((s) => {
      if (s.state === 'idle') {
        setIsListening(true)
        startMicCapture()
        // Simulate hotkey press event for CompanionManager
      }
    })
  }

  function handlePttRelease(): void {
    setIsListening(false)
    stopMicCapture()
  }

  // ---------------------------------------------------------------------------
  // TTS audio playback
  // ---------------------------------------------------------------------------

  async function playBase64Audio(base64: string): Promise<void> {
    const audioContext = new AudioContext()
    const arrayBuffer = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
    const source = audioContext.createBufferSource()
    source.buffer = audioBuffer
    source.connect(audioContext.destination)
    return new Promise((resolve) => {
      source.onended = () => resolve()
      source.start()
    })
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const lang = profile?.language ?? 'sw'
  const stateLabel = lang === 'sw'
    ? DS.stateLabels_sw[status?.state ?? 'idle']
    : DS.stateLabels_en[status?.state ?? 'idle']

  return (
    <div
      className="h-screen flex flex-col bg-bg text-white select-none overflow-hidden"
      style={{ fontFamily: DS.font.ui }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/8">
        {profile?.logoUrl ? (
          <img src={profile.logoUrl} alt="" className="w-7 h-7 rounded object-contain" />
        ) : (
          <div className="w-7 h-7 rounded bg-accent flex items-center justify-center text-bg text-xs font-bold">
            M
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{profile?.orgName ?? 'Mwongozo'}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <StateIndicator state={status?.state ?? 'idle'} />
            <span className="text-xs text-muted">{stateLabel}</span>
          </div>
        </div>
      </div>

      {/* Flow progress (if active) */}
      {status?.activeFlowId && status.activeFlowStep !== undefined && (
        <div className="px-4 py-3 border-b border-white/8">
          <FlowProgress
            flowId={status.activeFlowId}
            currentStep={status.activeFlowStep}
            totalSteps={5}  // TODO: get from flow context
          />
        </div>
      )}

      {/* Guidance area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Transcript */}
        {transcript && (
          <div className="text-xs text-muted italic border-l-2 border-accent/40 pl-2">
            "{transcript}"
          </div>
        )}

        {/* Last AI response */}
        {lastGuidance ? (
          <GuidanceCard guidance={lastGuidance} />
        ) : (
          <div className="text-center py-8 text-muted text-sm">
            <p className="text-3xl mb-2">🎙️</p>
            <p>Shikilia Ctrl+Shift kusema</p>
            <p className="text-xs mt-1 opacity-60">Hold Ctrl+Shift to ask for help</p>
          </div>
        )}
      </div>

      {/* PTT button */}
      <div className="px-4 pb-4 pt-2 border-t border-white/8">
        <PttButton
          isListening={isListening}
          onPress={handlePttPress}
          onRelease={handlePttRelease}
        />
      </div>
    </div>
  )
}

// Extend window for the IPC renderer used for TTS playback acknowledgement
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ipcRenderer?: any
  }
}
