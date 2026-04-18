/**
 * Orb renderer — premium glassmorphism floating companion.
 *
 * Design language:
 *  • Multi-layer glass sphere (radial-gradient depth illusion)
 *  • Dual counter-rotating conic-gradient rings (speed adapts to state)
 *  • Aura glow with pulse animation
 *  • Listening ripple rings
 *  • Iris eyes with specular highlight + eyelid blink
 *  • Breathing animation and smile that morphs per state
 */

import React, { useEffect, useRef, useState } from 'react'
import type { CompanionState, CompanionStatus, OrbConfig } from '../../shared/types'

// ─── size constants ─────────────────────────────────────────────────────────
const ORB     = 76
const EYE_W   = 15
const EYE_H   = 19
const PUPIL   = 9
const MAX_TRAVEL = 5

interface CursorPayload {
  cursorX: number; cursorY: number
  orbX:    number; orbY:    number
  orbW:    number; orbH:    number
}

// ─── helper ─────────────────────────────────────────────────────────────────
function hexRgb(hex: string): string {
  const h = hex.replace('#', '')
  return `${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)}`
}

// ─── Eye component ──────────────────────────────────────────────────────────
function Eye({
  px, py, blink, squint, theme,
}: {
  px: number; py: number; blink: boolean; squint: boolean; theme: string
}): React.ReactElement {
  const h = blink ? 1 : squint ? Math.round(EYE_H * 0.4) : EYE_H
  const rgb = hexRgb(theme)

  return (
    <div style={{
      width:        EYE_W,
      height:       h,
      borderRadius: '50%',
      background:   'radial-gradient(circle at 40% 35%, rgba(255,255,255,0.98), rgba(230,242,255,0.9) 60%, rgba(210,230,255,0.82))',
      boxShadow:    'inset 0 1.5px 4px rgba(0,0,0,0.18), 0 1px 2px rgba(255,255,255,0.3)',
      position:     'relative',
      overflow:     'hidden',
      flexShrink:   0,
      transition:   'height 0.09s ease',
    }}>
      {/* Eyelid */}
      <div style={{
        position:     'absolute',
        top: 0, left: 0, right: 0,
        height:       blink ? '100%' : 0,
        background:   `radial-gradient(circle at 50% 0%, rgba(${rgb},0.9), rgba(${rgb},0.7))`,
        borderRadius: '0 0 50% 50%',
        transition:   'height 0.08s ease',
      }} />

      {/* Pupil */}
      <div style={{
        position:     'absolute',
        width: PUPIL, height: PUPIL,
        borderRadius: '50%',
        background:   'radial-gradient(circle at 35% 30%, #1a1a2e, #05050f)',
        top: '50%', left: '50%',
        transform:    `translate(calc(-50% + ${px}px), calc(-50% + ${py}px))`,
        transition:   'transform 0.05s ease',
        boxShadow:    '0 1px 3px rgba(0,0,0,0.5)',
      }}>
        {/* Iris tint */}
        <div style={{
          position:     'absolute',
          inset:        0,
          borderRadius: '50%',
          background:   `rgba(${rgb},0.18)`,
        }} />
        {/* Specular highlight */}
        <div style={{
          position:     'absolute',
          width: 3, height: 3,
          borderRadius: '50%',
          background:   'rgba(255,255,255,0.95)',
          top: 1.5, left: 2,
        }} />
      </div>
    </div>
  )
}

// ─── main component ─────────────────────────────────────────────────────────
export function App(): React.ReactElement {
  const [pupil,    setPupil]    = useState({ x: 0, y: 0 })
  const [hovered,  setHovered]  = useState(false)
  const [blink,    setBlink]    = useState(false)
  const [pressed,  setPressed]  = useState(false)
  const [theme,    setTheme]    = useState('#6366f1')
  const [orbState, setOrbState] = useState<CompanionState>('idle')
  const blinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ringRotRef = useRef(0)
  const rafRef     = useRef<number>(0)
  const ringEl1    = useRef<HTMLDivElement>(null)
  const ringEl2    = useRef<HTMLDivElement>(null)

  // ── config + status ─────────────────────────────────────────────────────
  useEffect(() => {
    window.api.getOrbConfig().then((cfg: OrbConfig) => setTheme(cfg.theme))
    window.api.getStatus().then((s: CompanionStatus) => setOrbState(s.state))
    const u1 = window.api.onOrbConfig((cfg: OrbConfig) => setTheme(cfg.theme))
    const u2 = window.api.onStatus((s: CompanionStatus) => setOrbState(s.state))
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
      const norm  = Math.min(dist / 200, 1)
      const angle = Math.atan2(dy, dx)
      setPupil({
        x: Math.cos(angle) * MAX_TRAVEL * norm,
        y: Math.sin(angle) * MAX_TRAVEL * norm,
      })
    })
    return unsub
  }, [])

  // ── blink ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const schedule = (): void => {
      blinkTimer.current = setTimeout(() => {
        setBlink(true)
        setTimeout(() => { setBlink(false); schedule() }, 110)
      }, 2800 + Math.random() * 3800)
    }
    schedule()
    return () => { if (blinkTimer.current) clearTimeout(blinkTimer.current) }
  }, [])

  // ── ring animation (rAF) ─────────────────────────────────────────────────
  const orbStateRef = useRef(orbState)
  useEffect(() => { orbStateRef.current = orbState }, [orbState])

  useEffect(() => {
    const animate = (): void => {
      const s = orbStateRef.current
      const speed = s === 'processing' ? 3.5
        : s === 'listening'  ? 2.2
        : s === 'responding' ? 1.8
        : 0.55
      ringRotRef.current = (ringRotRef.current + speed) % 360
      if (ringEl1.current) ringEl1.current.style.transform = `rotate(${ringRotRef.current}deg)`
      if (ringEl2.current) ringEl2.current.style.transform = `rotate(${-ringRotRef.current * 0.55}deg)`
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  // ── click ────────────────────────────────────────────────────────────────
  function handleClick(): void {
    setPressed(true)
    setTimeout(() => setPressed(false), 130)
    window.api.orbClick()
  }

  // ── derived visuals ──────────────────────────────────────────────────────
  const rgb     = hexRgb(theme)
  const squint  = orbState === 'processing'
  const scale   = pressed ? 0.85 : hovered ? 1.09 : 1.0
  const smileW  = orbState === 'responding' ? 34 : orbState === 'listening' ? 22 : 28
  const smileAlpha = orbState === 'responding' ? 'e6' : orbState === 'idle' && hovered ? 'cc' : '88'

  // State-specific body shadow
  const bodyShadow = (() => {
    if (orbState === 'listening')  return `0 0 0 1.5px rgba(${rgb},0.35), 0 0 32px rgba(${rgb},0.85), 0 0 60px rgba(${rgb},0.4), 0 12px 40px rgba(0,0,0,0.45), inset 0 1.5px 0 rgba(255,255,255,0.45), inset 0 -2px 6px rgba(0,0,0,0.25)`
    if (orbState === 'processing') return `0 0 0 1.5px rgba(${rgb},0.15), 0 0 20px rgba(${rgb},0.5), 0 10px 30px rgba(0,0,0,0.55), inset 0 1.5px 0 rgba(255,255,255,0.28), inset 0 -2px 6px rgba(0,0,0,0.35)`
    if (orbState === 'responding') return `0 0 0 1.5px rgba(255,255,255,0.28), 0 0 40px rgba(${rgb},0.92), 0 0 80px rgba(${rgb},0.45), 0 16px 48px rgba(0,0,0,0.38), inset 0 1.5px 0 rgba(255,255,255,0.52), inset 0 -2px 6px rgba(0,0,0,0.18)`
    if (hovered)                   return `0 0 0 1.5px rgba(255,255,255,0.2), 0 0 28px rgba(${rgb},0.7), 0 12px 36px rgba(0,0,0,0.45), inset 0 1.5px 0 rgba(255,255,255,0.42), inset 0 -2px 6px rgba(0,0,0,0.22)`
    return `0 0 0 1.5px rgba(255,255,255,0.12), 0 0 14px rgba(${rgb},0.45), 0 8px 24px rgba(0,0,0,0.5), inset 0 1.5px 0 rgba(255,255,255,0.36), inset 0 -2px 6px rgba(0,0,0,0.28)`
  })()

  const bodyBrightness = orbState === 'processing' ? 'brightness(0.88) saturate(0.75)' : orbState === 'responding' ? 'brightness(1.06)' : 'none'

  // Aura pulse speed
  const auraAnimation = orbState === 'listening'
    ? 'mwz-aura 1.2s ease-in-out infinite'
    : orbState === 'processing'
    ? 'mwz-aura 1.8s ease-in-out infinite'
    : 'mwz-aura 3.2s ease-in-out infinite'

  // Body breathe animation
  const breatheAnimation = orbState === 'idle'
    ? 'mwz-breathe 4s ease-in-out infinite'
    : orbState === 'listening'
    ? 'mwz-breathe-fast 1.1s ease-in-out infinite'
    : orbState === 'responding'
    ? 'mwz-breathe 2.2s ease-in-out infinite'
    : 'none'

  const WRAP = ORB + 32  // wrapper size

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
      <style>{`
        @keyframes mwz-aura {
          0%,100% { transform: scale(1);    opacity: 0.55; }
          50%      { transform: scale(1.18); opacity: 1;    }
        }
        @keyframes mwz-breathe {
          0%,100% { transform: scale(1) translateY(0); }
          50%      { transform: scale(1.028) translateY(-1px); }
        }
        @keyframes mwz-breathe-fast {
          0%,100% { transform: scale(1) translateY(0); }
          50%      { transform: scale(1.055) translateY(-2px); }
        }
        @keyframes mwz-ripple {
          0%   { transform: translate(-50%,-50%) scale(1); opacity: 0.55; }
          100% { transform: translate(-50%,-50%) scale(2.4); opacity: 0; }
        }
        @keyframes mwz-state-badge-in {
          from { opacity:0; transform:scale(0.7) translateY(-2px); }
          to   { opacity:1; transform:scale(1) translateY(0); }
        }
      `}</style>

      {/* ── Wrapper ────────────────────────────────────────────────────── */}
      <div style={{ position: 'relative', width: WRAP, height: WRAP, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>

        {/* ── Aura ───────────────────────────────────────────────────── */}
        <div style={{
          position:     'absolute',
          width:        ORB + 52, height: ORB + 52,
          borderRadius: '50%',
          background:   `radial-gradient(circle, rgba(${rgb},0.3) 0%, transparent 68%)`,
          animation:    auraAnimation,
          pointerEvents:'none',
        }} />

        {/* ── Animated gradient rings ─────────────────────────────────── */}
        <div style={{
          position: 'absolute',
          width: ORB + 18, height: ORB + 18,
          borderRadius: '50%', pointerEvents: 'none',
        }}>
          {/* Ring 1 — primary arc */}
          <div ref={ringEl1} style={{
            position:     'absolute', inset: 0,
            borderRadius: '50%',
            border:       '2px solid transparent',
            background:   `transparent padding-box, conic-gradient(from 0deg, transparent 0%, ${theme} 22%, rgba(${rgb},0.4) 40%, transparent 50%) border-box`,
            opacity:      orbState === 'idle' ? 0.65 : 0.92,
          }} />
          {/* Ring 2 — secondary arc (counter-rotating) */}
          <div ref={ringEl2} style={{
            position:     'absolute', inset: 0,
            borderRadius: '50%',
            border:       '1.5px solid transparent',
            background:   `transparent padding-box, conic-gradient(from 0deg, transparent 55%, rgba(${rgb},0.35) 72%, transparent 82%) border-box`,
            opacity:      orbState === 'idle' ? 0.45 : 0.7,
          }} />
        </div>

        {/* ── Listening ripples ───────────────────────────────────────── */}
        {orbState === 'listening' && [0, 0.7, 1.4].map((delay, i) => (
          <div key={i} style={{
            position:     'absolute',
            top: '50%', left: '50%',
            width:        ORB, height: ORB,
            borderRadius: '50%',
            border:       `1.5px solid rgba(${rgb},0.55)`,
            animation:    `mwz-ripple 2s ease-out ${delay}s infinite`,
            pointerEvents:'none',
          }} />
        ))}

        {/* ── Orb body ────────────────────────────────────────────────── */}
        <div style={{
          width:        ORB, height: ORB,
          borderRadius: '50%',
          position:     'relative',
          overflow:     'hidden',
          cursor:       'pointer',
          transform:    `scale(${scale})`,
          transition:   'transform 0.14s cubic-bezier(.34,1.56,.64,1)',
          animation:    breatheAnimation,
          filter:       bodyBrightness !== 'none' ? bodyBrightness : undefined,
          background:   [
            `radial-gradient(circle at 34% 28%, rgba(255,255,255,0.44) 0%, transparent 36%)`,
            `radial-gradient(circle at 72% 76%, rgba(${rgb},0.2) 0%, transparent 32%)`,
            `radial-gradient(circle at 50% 50%, rgba(${rgb},0.95) 0%, rgba(${rgb},0.8) 42%, rgba(${rgb},0.58) 100%)`,
          ].join(','),
          boxShadow:    bodyShadow,
        }}>
          {/* Primary glass gloss */}
          <div style={{
            position:     'absolute', top: 9, left: 13,
            width: 24, height: 13, borderRadius: '50%',
            background:   'rgba(255,255,255,0.38)',
            transform:    'rotate(-30deg)',
            filter:       'blur(1px)',
            pointerEvents:'none',
          }} />
          {/* Secondary micro-gloss */}
          <div style={{
            position:     'absolute', top: 19, left: 22,
            width: 9, height: 5, borderRadius: '50%',
            background:   'rgba(255,255,255,0.22)',
            pointerEvents:'none',
          }} />
          {/* Bottom rim sheen */}
          <div style={{
            position:     'absolute', bottom: 8, left: '50%',
            transform:    'translateX(-50%)',
            width: 42, height: 8, borderRadius: '50%',
            background:   `rgba(${rgb},0.28)`,
            filter:       'blur(3px)',
            pointerEvents:'none',
          }} />

          {/* Eyes */}
          <div style={{
            position:  'absolute', top: '38%', left: '50%',
            transform: 'translate(-50%, -50%)',
            display:   'flex', gap: 11,
          }}>
            <Eye px={pupil.x} py={pupil.y} blink={blink} squint={squint} theme={theme} />
            <Eye px={pupil.x} py={pupil.y} blink={blink} squint={squint} theme={theme} />
          </div>

          {/* Smile */}
          <div style={{
            position:     'absolute', bottom: 13, left: '50%',
            transform:    'translateX(-50%)',
            width:        smileW, height: 10,
            borderBottom: orbState === 'processing'
              ? 'none'
              : `2px solid ${theme}${smileAlpha}`,
            borderTop: orbState === 'processing'
              ? `2px solid rgba(${rgb},0.35)`
              : 'none',
            borderRadius: orbState === 'processing' ? '50% 50% 0 0' : '0 0 50% 50%',
            transition:   'width 0.3s ease, border-color 0.3s ease',
            pointerEvents:'none',
          }} />
        </div>

        {/* ── State badge ──────────────────────────────────────────────── */}
        {(orbState === 'listening' || orbState === 'responding') && (
          <div style={{
            position:    'absolute',
            top:         -4, right: -8,
            background:  orbState === 'listening' ? 'rgba(239,68,68,0.92)' : `rgba(${rgb},0.92)`,
            color:       '#fff',
            fontSize:    9,
            fontWeight:  700,
            fontFamily:  'system-ui, sans-serif',
            letterSpacing:'0.05em',
            padding:     '3px 6px',
            borderRadius: 8,
            whiteSpace:  'nowrap',
            boxShadow:   '0 2px 8px rgba(0,0,0,0.35)',
            border:      '1px solid rgba(255,255,255,0.2)',
            animation:   'mwz-state-badge-in 0.2s ease',
            pointerEvents:'none',
          }}>
            {orbState === 'listening' ? '● REC' : '♪'}
          </div>
        )}
      </div>
    </div>
  )
}
