/**
 * Orb renderer — the bottom-right floating character.
 *
 * • Two eyes that follow the system cursor in real-time
 * • Random blinking every 3-6 s to feel alive
 * • Hover glow + press squeeze animation
 * • Clicking toggles the panel window
 * • Reacts to OrbConfig changes (theme colour)
 */

import React, { useEffect, useRef, useState } from 'react'
import type { OrbConfig } from '../../shared/types'

// ─── sizes (logical px) ────────────────────────────────────────────────────
const ORB          = 66   // orb body diameter
const EYE_W        = 14   // eye width
const EYE_H        = 17   // eye height (slightly tall oval)
const PUPIL        = 8    // pupil diameter
const MAX_TRAVEL   = 4.5  // max pixels pupil moves from eye center

// ─── types from preload ────────────────────────────────────────────────────
interface CursorPayload {
  cursorX: number; cursorY: number
  orbX:    number; orbY:    number
  orbW:    number; orbH:    number
}

// ─── one eye ───────────────────────────────────────────────────────────────
function Eye({
  px, py, blink,
}: {
  px: number; py: number; blink: boolean
}): React.ReactElement {
  return (
    <div
      style={{
        width:         EYE_W,
        height:        blink ? 2 : EYE_H,
        borderRadius:  '50%',
        background:    '#edfaed',
        position:      'relative',
        overflow:      'hidden',
        flexShrink:    0,
        boxShadow:     'inset 0 1px 4px rgba(0,0,0,0.18)',
        transition:    'height 0.07s ease',
      }}
    >
      {/* Pupil */}
      <div
        style={{
          position:  'absolute',
          width:     PUPIL,
          height:    PUPIL,
          borderRadius: '50%',
          background: '#0c1c0c',
          top:  '50%',
          left: '50%',
          transform: `translate(calc(-50% + ${px}px), calc(-50% + ${py}px))`,
        }}
      >
        {/* Catchlight */}
        <div
          style={{
            position:     'absolute',
            width:        3,
            height:       3,
            borderRadius: '50%',
            background:   'rgba(255,255,255,0.92)',
            top:  1.5,
            left: 2,
          }}
        />
      </div>
    </div>
  )
}

// ─── main component ────────────────────────────────────────────────────────
export function App(): React.ReactElement {
  const [pupil,   setPupil]   = useState({ x: 0, y: 0 })
  const [hovered, setHovered] = useState(false)
  const [blink,   setBlink]   = useState(false)
  const [pressed, setPressed] = useState(false)
  const [theme,   setTheme]   = useState('#10b981')
  const blinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── load initial config + subscribe to changes ──────────────────────────
  useEffect(() => {
    window.api.getOrbConfig().then((cfg: OrbConfig) => setTheme(cfg.theme))
    const unsub = window.api.onOrbConfig((cfg: OrbConfig) => setTheme(cfg.theme))
    return unsub
  }, [])

  // ── cursor tracking from main process ──────────────────────────────────
  useEffect(() => {
    const unsub = window.api.onCursorMove((d: CursorPayload) => {
      const cx = d.orbX + d.orbW / 2
      const cy = d.orbY + d.orbH / 2
      const dx = d.cursorX - cx
      const dy = d.cursorY - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const norm  = Math.min(dist / 180, 1)   // full travel reached at 180 px away
      const angle = Math.atan2(dy, dx)
      setPupil({
        x: Math.cos(angle) * MAX_TRAVEL * norm,
        y: Math.sin(angle) * MAX_TRAVEL * norm,
      })
    })
    return unsub
  }, [])

  // ── random blinking ────────────────────────────────────────────────────
  useEffect(() => {
    const schedule = (): void => {
      blinkTimer.current = setTimeout(() => {
        setBlink(true)
        setTimeout(() => {
          setBlink(false)
          schedule()
        }, 110)
      }, 3000 + Math.random() * 3500)
    }
    schedule()
    return () => { if (blinkTimer.current) clearTimeout(blinkTimer.current) }
  }, [])

  // ── click handler ──────────────────────────────────────────────────────
  function handleClick(): void {
    setPressed(true)
    setTimeout(() => setPressed(false), 140)
    window.api.orbClick()
  }

  const scale = pressed ? 0.86 : hovered ? 1.07 : 1.0

  // Derive lighter body colours from the theme hex
  const themeR = parseInt(theme.slice(1, 3), 16)
  const themeG = parseInt(theme.slice(3, 5), 16)
  const themeB = parseInt(theme.slice(5, 7), 16)
  const bodyDark  = `rgb(${Math.round(themeR * 0.08)}, ${Math.round(themeG * 0.12)}, ${Math.round(themeB * 0.06)})`
  const bodyMid   = `rgb(${Math.round(themeR * 0.16)}, ${Math.round(themeG * 0.20)}, ${Math.round(themeB * 0.12)})`
  const bodyLight = `rgb(${Math.round(themeR * 0.28)}, ${Math.round(themeG * 0.32)}, ${Math.round(themeB * 0.22)})`

  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width:          '100vw',
        height:         '100vh',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        background:     'transparent',
        cursor:         'pointer',
        userSelect:     'none',
        WebkitUserSelect: 'none',
      } as React.CSSProperties}
    >

      {/* ── pulsing halo ─────────────────────────────────────────────────── */}
      <div
        style={{
          position:     'absolute',
          width:        ORB + 28,
          height:       ORB + 28,
          borderRadius: '50%',
          background:   hovered
            ? `radial-gradient(circle, ${theme}61 0%, transparent 68%)`
            : `radial-gradient(circle, ${theme}2e 0%, transparent 68%)`,
          animation:    'halo 2.8s ease-in-out infinite',
          pointerEvents:'none',
          transition:   'background 0.3s ease',
        }}
      />

      {/* ── orb body ─────────────────────────────────────────────────────── */}
      <div
        style={{
          width:        ORB,
          height:       ORB,
          borderRadius: '50%',
          background:   `radial-gradient(circle at 38% 30%, ${bodyLight} 0%, ${bodyMid} 50%, ${bodyDark} 100%)`,
          border:       `2px solid ${hovered ? theme + 'e6' : theme + '85'}`,
          boxShadow:    hovered
            ? `0 0 26px ${theme}99, 0 8px 22px rgba(0,0,0,0.65)`
            : `0 0 12px ${theme}47, 0 5px 14px rgba(0,0,0,0.55)`,
          position:     'relative',
          overflow:     'hidden',
          transform:    `scale(${scale})`,
          transition:   'transform 0.13s cubic-bezier(.34,1.56,.64,1), border-color 0.2s, box-shadow 0.2s, background 0.4s',
        }}
      >
        {/* Top-left gloss */}
        <div
          style={{
            position:     'absolute',
            top:          7,
            left:         12,
            width:        24,
            height:       13,
            borderRadius: '50%',
            background:   'rgba(255,255,255,0.13)',
            transform:    'rotate(-28deg)',
            pointerEvents:'none',
          }}
        />

        {/* Bottom rim shimmer */}
        <div
          style={{
            position:     'absolute',
            bottom:       4,
            left:         '50%',
            transform:    'translateX(-50%)',
            width:        38,
            height:       7,
            borderRadius: '50%',
            background:   `${theme}38`,
            pointerEvents:'none',
          }}
        />

        {/* ── eyes ───────────────────────────────────────────────────────── */}
        <div
          style={{
            position:  'absolute',
            top:       '38%',
            left:      '50%',
            transform: 'translate(-50%, -50%)',
            display:   'flex',
            gap:       10,
          }}
        >
          <Eye px={pupil.x} py={pupil.y} blink={blink} />
          <Eye px={pupil.x} py={pupil.y} blink={blink} />
        </div>

        {/* ── smile arc ──────────────────────────────────────────────────── */}
        <div
          style={{
            position:     'absolute',
            bottom:       12,
            left:         '50%',
            transform:    'translateX(-50%)',
            width:        26,
            height:       10,
            borderBottom: `2px solid ${theme}${hovered ? 'd9' : '80'}`,
            borderRadius: '0 0 50% 50%',
            transition:   'border-color 0.2s',
            pointerEvents:'none',
          }}
        />
      </div>

      {/* ── keyframe animations ──────────────────────────────────────────── */}
      <style>{`
        @keyframes halo {
          0%, 100% { transform: scale(1);    opacity: 0.75; }
          50%       { transform: scale(1.15); opacity: 1;    }
        }
      `}</style>
    </div>
  )
}
