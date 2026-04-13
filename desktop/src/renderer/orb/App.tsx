/**
 * Orb renderer — the bottom-right floating character.
 *
 * • Two eyes that follow the system cursor in real-time
 * • Random blinking every 3-6 s
 * • Hover glow + press squeeze
 * • Clicking toggles the panel
 * • Reacts to companion state: listening / processing / responding
 * • Reacts to OrbConfig changes (theme colour)
 */

import React, { useEffect, useRef, useState } from 'react'
import type { CompanionState, CompanionStatus, OrbConfig } from '../../shared/types'

// ─── sizes ─────────────────────────────────────────────────────────────────
const ORB        = 66
const EYE_W      = 14
const EYE_H      = 17
const PUPIL      = 8
const MAX_TRAVEL = 4.5

interface CursorPayload {
  cursorX: number; cursorY: number
  orbX:    number; orbY:    number
  orbW:    number; orbH:    number
}

// ─── one eye ───────────────────────────────────────────────────────────────
function Eye({
  px, py, blink, squint,
}: {
  px: number; py: number; blink: boolean; squint: boolean
}): React.ReactElement {
  const h = blink ? 2 : squint ? Math.round(EYE_H * 0.45) : EYE_H
  return (
    <div style={{
      width:      EYE_W,
      height:     h,
      borderRadius: '50%',
      background: '#edfaed',
      position:   'relative',
      overflow:   'hidden',
      flexShrink: 0,
      boxShadow:  'inset 0 1px 4px rgba(0,0,0,0.18)',
      transition: 'height 0.1s ease',
    }}>
      <div style={{
        position:  'absolute',
        width:     PUPIL, height: PUPIL,
        borderRadius: '50%',
        background: '#0c1c0c',
        top: '50%', left: '50%',
        transform: `translate(calc(-50% + ${px}px), calc(-50% + ${py}px))`,
      }}>
        <div style={{
          position: 'absolute',
          width: 3, height: 3,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.92)',
          top: 1.5, left: 2,
        }} />
      </div>
    </div>
  )
}

// ─── main component ────────────────────────────────────────────────────────
export function App(): React.ReactElement {
  const [pupil,    setPupil]    = useState({ x: 0, y: 0 })
  const [hovered,  setHovered]  = useState(false)
  const [blink,    setBlink]    = useState(false)
  const [pressed,  setPressed]  = useState(false)
  const [theme,    setTheme]    = useState('#10b981')
  const [orbState, setOrbState] = useState<CompanionState>('idle')
  const blinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── load config + subscribe to changes ─────────────────────────────────
  useEffect(() => {
    window.api.getOrbConfig().then((cfg: OrbConfig)           => setTheme(cfg.theme))
    window.api.getStatus().then((s: CompanionStatus)           => setOrbState(s.state))
    const u1 = window.api.onOrbConfig((cfg: OrbConfig)         => setTheme(cfg.theme))
    const u2 = window.api.onStatus((s: CompanionStatus)        => setOrbState(s.state))
    return () => { u1(); u2() }
  }, [])

  // ── cursor tracking ─────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = window.api.onCursorMove((d: CursorPayload) => {
      const cx = d.orbX + d.orbW / 2
      const cy = d.orbY + d.orbH / 2
      const dx = d.cursorX - cx
      const dy = d.cursorY - cy
      const dist  = Math.sqrt(dx * dx + dy * dy)
      const norm  = Math.min(dist / 180, 1)
      const angle = Math.atan2(dy, dx)
      setPupil({ x: Math.cos(angle) * MAX_TRAVEL * norm, y: Math.sin(angle) * MAX_TRAVEL * norm })
    })
    return unsub
  }, [])

  // ── random blinking ─────────────────────────────────────────────────────
  useEffect(() => {
    const schedule = (): void => {
      blinkTimer.current = setTimeout(() => {
        setBlink(true)
        setTimeout(() => { setBlink(false); schedule() }, 110)
      }, 3000 + Math.random() * 3500)
    }
    schedule()
    return () => { if (blinkTimer.current) clearTimeout(blinkTimer.current) }
  }, [])

  // ── click ───────────────────────────────────────────────────────────────
  function handleClick(): void {
    setPressed(true)
    setTimeout(() => setPressed(false), 140)
    window.api.orbClick()
  }

  // ── derive visual properties from state ────────────────────────────────
  const scale   = pressed ? 0.86 : hovered ? 1.07 : 1.0
  const squint  = orbState === 'processing'
  const excited = orbState === 'responding'

  // Halo speed & intensity
  const haloAnimation = orbState === 'processing'
    ? 'halo 1.2s ease-in-out infinite'
    : orbState === 'listening'
    ? 'halo 1.8s ease-in-out infinite'
    : 'halo 2.8s ease-in-out infinite'

  const glowAlpha = orbState === 'listening' ? '5c'
    : orbState === 'processing' ? '3d'
    : orbState === 'responding' ? '70'
    : hovered ? '61' : '2e'

  // Body colour from theme
  const r = parseInt(theme.slice(1, 3), 16)
  const g = parseInt(theme.slice(3, 5), 16)
  const b = parseInt(theme.slice(5, 7), 16)
  const bodyLight = `rgb(${Math.round(r * 0.28)}, ${Math.round(g * 0.32)}, ${Math.round(b * 0.22)})`
  const bodyMid   = `rgb(${Math.round(r * 0.16)}, ${Math.round(g * 0.20)}, ${Math.round(b * 0.12)})`
  const bodyDark  = `rgb(${Math.round(r * 0.08)}, ${Math.round(g * 0.12)}, ${Math.round(b * 0.06)})`

  // Border brightness by state
  const borderAlpha = orbState === 'listening' ? 'ff'
    : orbState === 'responding' ? 'ff'
    : orbState === 'processing' ? 'cc'
    : hovered ? 'e6' : '85'

  // Glow ring radius changes when processing
  const shadowStr = orbState === 'processing'
    ? `0 0 22px ${theme}a0, 0 0 40px ${theme}44, 0 8px 22px rgba(0,0,0,0.65)`
    : orbState === 'listening'
    ? `0 0 28px ${theme}b0, 0 8px 22px rgba(0,0,0,0.65)`
    : hovered
    ? `0 0 26px ${theme}99, 0 8px 22px rgba(0,0,0,0.65)`
    : `0 0 12px ${theme}47, 0 5px 14px rgba(0,0,0,0.55)`

  // Smile arc — wider when responding
  const smileW = excited ? 32 : 26
  const smileAlpha = (orbState === 'responding' || hovered) ? 'd9' : '80'

  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100vw', height: '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', cursor: 'pointer',
        userSelect: 'none', WebkitUserSelect: 'none',
      } as React.CSSProperties}
    >
      {/* Pulsing halo */}
      <div style={{
        position: 'absolute',
        width: ORB + 28, height: ORB + 28,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${theme}${glowAlpha} 0%, transparent 68%)`,
        animation: haloAnimation,
        pointerEvents: 'none',
        transition: 'background 0.3s ease',
      }} />

      {/* Processing ring spinner */}
      {orbState === 'processing' && (
        <div style={{
          position: 'absolute',
          width: ORB + 10, height: ORB + 10,
          borderRadius: '50%',
          border: `2px solid transparent`,
          borderTopColor: theme + 'cc',
          borderRightColor: theme + '55',
          animation: 'spin 1s linear infinite',
          pointerEvents: 'none',
        }} />
      )}

      {/* Orb body */}
      <div style={{
        width: ORB, height: ORB,
        borderRadius: '50%',
        background: `radial-gradient(circle at 38% 30%, ${bodyLight} 0%, ${bodyMid} 50%, ${bodyDark} 100%)`,
        border: `2px solid ${theme}${borderAlpha}`,
        boxShadow: shadowStr,
        position: 'relative', overflow: 'hidden',
        transform: `scale(${scale})`,
        transition: 'transform 0.13s cubic-bezier(.34,1.56,.64,1), border-color 0.2s, box-shadow 0.2s, background 0.4s',
      }}>
        {/* Gloss */}
        <div style={{
          position: 'absolute', top: 7, left: 12,
          width: 24, height: 13, borderRadius: '50%',
          background: 'rgba(255,255,255,0.13)',
          transform: 'rotate(-28deg)', pointerEvents: 'none',
        }} />

        {/* Rim shimmer */}
        <div style={{
          position: 'absolute', bottom: 4, left: '50%',
          transform: 'translateX(-50%)',
          width: 38, height: 7, borderRadius: '50%',
          background: `${theme}38`, pointerEvents: 'none',
        }} />

        {/* Eyes */}
        <div style={{
          position: 'absolute', top: '38%', left: '50%',
          transform: 'translate(-50%, -50%)',
          display: 'flex', gap: 10,
        }}>
          <Eye px={pupil.x} py={pupil.y} blink={blink} squint={squint} />
          <Eye px={pupil.x} py={pupil.y} blink={blink} squint={squint} />
        </div>

        {/* Smile */}
        <div style={{
          position: 'absolute', bottom: 12, left: '50%',
          transform: 'translateX(-50%)',
          width: smileW, height: 10,
          borderBottom: `2px solid ${theme}${smileAlpha}`,
          borderRadius: '0 0 50% 50%',
          transition: 'border-color 0.2s, width 0.2s',
          pointerEvents: 'none',
        }} />
      </div>

      {/* State label (listening / responding) */}
      {(orbState === 'listening' || orbState === 'responding') && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translateX(-50%) translateY(calc(-50% + 42px))',
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: theme,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}>
          {orbState === 'listening' ? '● REC' : '♪'}
        </div>
      )}

      <style>{`
        @keyframes halo {
          0%, 100% { transform: scale(1);    opacity: 0.75; }
          50%       { transform: scale(1.15); opacity: 1;    }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
