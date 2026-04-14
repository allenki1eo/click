/**
 * Overlay renderer — full-screen transparent window drawn over everything.
 *
 * Shows an animated Mac-style cursor that glides from the orb corner to the
 * AI-identified target coordinate, then rings pulse at the landing point.
 *
 * Design principles:
 * - SVG cursor with hotspot at (0,0) so tip lands exactly on the coordinate
 * - CSS `transform: translate(x,y)` — GPU-accelerated, no rAF loop needed
 * - Spring cubic-bezier (ease-out with tiny overshoot) matches macOS feel
 * - Cursor emerges from bottom-right (orb area), travels to target
 * - Bubble text fades in only after cursor arrives
 * - Theme colour from OrbConfig so rings match the orb
 */

import React, { useEffect, useRef, useState } from 'react'
import type { OrbConfig, PointTarget } from '../../shared/types'

// ── Mac-style arrow cursor SVG ──────────────────────────────────────────────
// Tip is at (0,0) so translate(x,y) positions it exactly at the target.
// Shape mirrors the macOS default cursor (northwest arrow).
function CursorSvg({ theme }: { theme: string }): React.ReactElement {
  return (
    <svg
      width="28" height="34"
      viewBox="0 0 28 34"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
    >
      {/* Drop shadow layer — slightly offset, semi-transparent */}
      <path
        d="M1.5 2.5 L1.5 24 L7 17.5 L11.5 28.5 L15.5 27 L11 16 L19.5 16 Z"
        fill="rgba(0,0,0,0.28)"
      />
      {/* White fill */}
      <path
        d="M0 0 L0 21.5 L5.5 15 L10 26 L14 24.5 L9.5 13.5 L18 13.5 Z"
        fill="white"
      />
      {/* Dark outline */}
      <path
        d="M0 0 L0 21.5 L5.5 15 L10 26 L14 24.5 L9.5 13.5 L18 13.5 Z"
        stroke="#111"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      {/* Accent dot at tip — matches orb theme colour */}
      <circle cx="0" cy="0" r="3.5" fill={theme} opacity="0.95" />
    </svg>
  )
}

// ── ripple ring (one ring) ───────────────────────────────────────────────────
function Ring({
  delay, theme,
}: { delay: number; theme: string }): React.ReactElement {
  return (
    <span style={{
      position: 'absolute',
      borderRadius: '50%',
      border: `1.5px solid ${theme}`,
      width: 56, height: 56,
      top: -28, left: -28,
      animation: `orbRipple 1.6s ease-out ${delay}s infinite`,
      pointerEvents: 'none',
    }} />
  )
}

// ── main component ──────────────────────────────────────────────────────────
export function App(): React.ReactElement {
  const [visible,      setVisible]      = useState(false)
  const [target,       setTarget]       = useState<PointTarget | null>(null)
  const [bubbleText,   setBubbleText]   = useState('')
  const [arrived,      setArrived]      = useState(false)
  const [theme,        setTheme]        = useState('#10b981')

  // Cursor position — driven entirely by CSS transition on `transform`
  const [pos,          setPos]          = useState({ x: 0, y: 0 })
  const [animated,     setAnimated]     = useState(false)  // enables the CSS transition

  const arrivalTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── load theme colour ──────────────────────────────────────────────────────
  useEffect(() => {
    window.api.getOrbConfig().then((cfg: OrbConfig) => setTheme(cfg.theme))
    const subs = [
      window.api.onOrbConfig((cfg: OrbConfig) => setTheme(cfg.theme)),

      window.api.onOverlayPoint((p: PointTarget) => {
        if (arrivalTimer.current) clearTimeout(arrivalTimer.current)

        // Reset arrived / text so they don't flash from a previous call
        setArrived(false)
        setBubbleText('')

        // Step 1 — place cursor at start (bottom-right, near orb), NO transition
        const startX = window.innerWidth  - 54
        const startY = window.innerHeight - 54
        setAnimated(false)
        setPos({ x: startX, y: startY })
        setTarget(p)
        setVisible(true)

        // Step 2 — two rAFs ensure the browser paints the starting position
        //          before we switch on the CSS transition and set the target pos
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setAnimated(true)
            setPos({ x: p.x, y: p.y })

            // Arrival fires after animation duration (860 ms)
            arrivalTimer.current = setTimeout(() => setArrived(true), 860)
          })
        })
      }),

      window.api.onOverlayText((t: string) => {
        // Store the full response; show it (or the POINT label) in the bubble
        setBubbleText(t)
      }),

      window.api.onOverlayHide(() => {
        if (arrivalTimer.current) clearTimeout(arrivalTimer.current)
        setVisible(false)
        setTarget(null)
        setBubbleText('')
        setArrived(false)
        setAnimated(false)
      }),
    ]
    return () => subs.forEach((u) => u())
  }, [])

  if (!visible || !target) return <></>

  // ── bubble positioning ────────────────────────────────────────────────────
  const label = target.label || bubbleText
  const bubbleW    = 230
  const bubbleAbove = target.y > window.innerHeight * 0.55
  const bubbleLeft  = Math.min(
    Math.max(target.x - bubbleW / 2, 12),
    window.innerWidth - bubbleW - 12,
  )
  const bubbleTop   = bubbleAbove
    ? target.y - 94
    : target.y + 34
  // Arrow tip x relative to bubble container
  const arrowOffset = Math.min(
    Math.max(target.x - bubbleLeft - 9, 14),
    bubbleW - 28,
  )

  return (
    <div style={{
      position: 'fixed', inset: 0,
      pointerEvents: 'none', overflow: 'hidden',
    }}>

      {/* ── animated cursor ─────────────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          left: 0, top: 0,
          // `transform` is the only property that changes — pure GPU layer
          transform: `translate(${pos.x}px, ${pos.y}px)`,
          transition: animated
            ? 'transform 0.86s cubic-bezier(0.22, 1, 0.36, 1)'
            : 'none',
          willChange: 'transform',
          pointerEvents: 'none',
          zIndex: 60,
          // Drop shadow on the whole cursor group
          filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.45))',
        }}
      >
        <CursorSvg theme={theme} />
      </div>

      {/* ── ripple rings at target — appear on arrival ──────────────────── */}
      {arrived && (
        <div style={{
          position: 'absolute',
          left: target.x, top: target.y,
          pointerEvents: 'none',
          zIndex: 55,
        }}>
          <Ring delay={0}    theme={theme} />
          <Ring delay={0.55} theme={theme} />
          {/* Centre dot */}
          <span style={{
            position: 'absolute',
            borderRadius: '50%',
            backgroundColor: theme,
            width: 9, height: 9,
            top: -4.5, left: -4.5,
            boxShadow: `0 0 14px 5px ${theme}55`,
            animation: 'dotPulse 2s ease-in-out infinite',
          }} />
        </div>
      )}

      {/* ── text bubble — fades in on arrival ───────────────────────────── */}
      {arrived && label && (
        <div style={{
          position: 'absolute',
          left: bubbleLeft,
          top: bubbleTop,
          width: bubbleW,
          padding: '9px 13px',
          borderRadius: 11,
          background: 'rgba(10,14,20,0.96)',
          border: `1.5px solid ${theme}55`,
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          boxShadow: '0 6px 28px rgba(0,0,0,0.55)',
          color: '#f0f4f8',
          fontSize: 12.5,
          lineHeight: 1.55,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          animation: 'bubbleFadeIn 0.3s ease forwards',
          pointerEvents: 'none',
          zIndex: 65,
          // Limit to label text (short) not the full response (long)
          maxHeight: 110,
          overflow: 'hidden',
        }}>
          {/* Show label if present, otherwise first sentence of response */}
          {target.label || (bubbleText.length > 100
            ? bubbleText.slice(0, bubbleText.lastIndexOf(' ', 100)) + '…'
            : bubbleText)}

          {/* Bubble arrow */}
          <span style={{
            position: 'absolute',
            left: arrowOffset,
            [bubbleAbove ? 'bottom' : 'top']: -9,
            borderLeft: '9px solid transparent',
            borderRight: '9px solid transparent',
            [bubbleAbove ? 'borderTop' : 'borderBottom']: '9px solid rgba(10,14,20,0.96)',
          }} />
        </div>
      )}

      {/* ── CSS keyframes ────────────────────────────────────────────────── */}
      <style>{`
        @keyframes orbRipple {
          0%   { transform: scale(0.2); opacity: 0.9; }
          100% { transform: scale(2.2); opacity: 0;   }
        }
        @keyframes dotPulse {
          0%, 100% { transform: scale(1);   opacity: 1;   }
          50%       { transform: scale(1.4); opacity: 0.7; }
        }
        @keyframes bubbleFadeIn {
          from { opacity: 0; transform: translateY(5px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
      `}</style>
    </div>
  )
}
