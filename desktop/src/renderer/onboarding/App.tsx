/**
 * OnboardingApp — first-run org code entry screen.
 *
 * New component (no Clicky equivalent).
 *
 * The user enters their org code (e.g. "KPMG-TZ-4829" or "DEMO-TZ-0001").
 * On success, the window closes and the tray companion becomes active.
 *
 * The demo code "DEMO-TZ-0001" works offline without a proxy.
 */

import React, { useState, useRef, useEffect } from 'react'
import { DS } from '../styles/design-tokens'
import type { OrgProfile } from '../../shared/types'

// ---------------------------------------------------------------------------
// Logo / brand mark
// ---------------------------------------------------------------------------

function BrandMark(): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-3">
      {/* Green circle logomark */}
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ backgroundColor: DS.colors.accent }}
      >
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          {/* Simplified cursor/pointer icon */}
          <path
            d="M8 6l18 10-8 2-4 8L8 6z"
            fill="#0a0e17"
            stroke="#0a0e17"
            strokeWidth="1"
          />
        </svg>
      </div>
      <div className="text-center">
        <h1 className="text-xl font-bold text-white">Mwongozo</h1>
        <p className="text-sm text-muted mt-0.5">AI Navigator — Tanzania</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Code input with auto-formatting
// ---------------------------------------------------------------------------

interface CodeInputProps {
  value: string
  onChange: (v: string) => void
  disabled: boolean
  error: boolean
}

function CodeInput({ value, onChange, disabled, error }: CodeInputProps): React.ReactElement {
  // Auto-uppercase and format as ORG-TZ-XXXX
  function handleChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '')
    onChange(raw)
  }

  return (
    <input
      type="text"
      value={value}
      onChange={handleChange}
      disabled={disabled}
      placeholder="DEMO-TZ-0001"
      maxLength={20}
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      className={`
        w-full px-4 py-3 rounded-lg text-center text-lg font-mono font-semibold
        tracking-widest outline-none transition-all duration-150
        ${error
          ? 'border-2 border-danger bg-danger/10 text-danger'
          : 'border-2 border-transparent bg-surface2 text-white focus:border-accent'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
      style={{ fontFamily: DS.font.mono, letterSpacing: '0.1em' }}
    />
  )
}

// ---------------------------------------------------------------------------
// Success screen
// ---------------------------------------------------------------------------

function SuccessScreen({ profile }: { profile: OrgProfile }): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-4 animate-fade-in">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ backgroundColor: DS.colors.accent }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0a0e17" strokeWidth="3">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div className="text-center">
        <h2 className="text-lg font-semibold text-white">Umefanikiwa!</h2>
        <p className="text-sm text-muted mt-1">Karibu, {profile.orgName}</p>
      </div>
      <p className="text-xs text-muted text-center px-4">
        Programu inaendelea kwenye tray ya mfumo.
        <br />
        <span className="opacity-60">App is running in your system tray.</span>
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main onboarding component
// ---------------------------------------------------------------------------

export function OnboardingApp(): React.ReactElement {
  const [code, setCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [successProfile, setSuccessProfile] = useState<OrgProfile | null>(null)
  const inputRef = useRef<HTMLDivElement>(null)

  // Auto-close after success
  useEffect(() => {
    if (successProfile) {
      const timer = setTimeout(() => {
        window.electronAPI.closeOnboarding()
      }, 2500)
      return () => clearTimeout(timer)
    }
  }, [successProfile])

  async function handleActivate(): Promise<void> {
    if (!code.trim()) {
      setError('Weka nambari ya shirika / Enter your org code')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const response = await window.electronAPI.activateCode({
        code: code.trim(),
        appVersion: '0.1.0'
      })

      if (response.success && response.profile) {
        setSuccessProfile(response.profile)
      } else {
        setError(response.error ?? 'Nambari si sahihi. / Invalid code.')
      }
    } catch (err) {
      setError('Hitilafu ya mtandao. Jaribu tena. / Network error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Enter') {
      handleActivate()
    }
  }

  return (
    <div
      className="h-screen flex flex-col items-center justify-center bg-bg px-6"
      style={{ fontFamily: DS.font.ui }}
      onKeyDown={handleKeyDown}
    >
      {successProfile ? (
        <SuccessScreen profile={successProfile} />
      ) : (
        <div className="w-full max-w-sm flex flex-col gap-6 animate-fade-in">
          {/* Brand */}
          <BrandMark />

          {/* Form */}
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs font-medium text-muted uppercase tracking-wider block mb-2">
                Nambari ya Shirika / Org Code
              </label>
              <div ref={inputRef}>
                <CodeInput
                  value={code}
                  onChange={(v) => {
                    setCode(v)
                    if (error) setError('')
                  }}
                  disabled={isLoading}
                  error={!!error}
                />
              </div>
              {error && (
                <p className="text-xs text-danger mt-1.5 animate-fade-in">{error}</p>
              )}
            </div>

            <button
              onClick={handleActivate}
              disabled={isLoading || !code.trim()}
              className={`
                w-full py-3 px-4 rounded-lg font-semibold text-sm transition-all duration-150
                flex items-center justify-center gap-2
                ${isLoading || !code.trim()
                  ? 'bg-surface2 text-muted cursor-not-allowed opacity-60'
                  : 'bg-accent text-bg hover:opacity-90 active:scale-[0.98]'
                }
              `}
            >
              {isLoading ? (
                <>
                  <SpinnerIcon />
                  Inathibitisha...
                </>
              ) : (
                'Ingia / Activate'
              )}
            </button>
          </div>

          {/* Demo hint */}
          <div
            className="rounded-lg p-3 text-center"
            style={{ backgroundColor: DS.colors.surface, border: `1px solid ${DS.colors.border}` }}
          >
            <p className="text-xs text-muted">
              Demo? Tumia nambari{' '}
              <button
                className="font-mono text-accent hover:underline"
                onClick={() => setCode('DEMO-TZ-0001')}
                style={{ fontFamily: DS.font.mono }}
              >
                DEMO-TZ-0001
              </button>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function SpinnerIcon(): React.ReactElement {
  return (
    <svg
      className="animate-spin"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity="0.3" />
      <path d="M21 12a9 9 0 00-9-9" />
    </svg>
  )
}
