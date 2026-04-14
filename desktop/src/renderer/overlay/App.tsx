/**
 * Overlay renderer — full-screen transparent window drawn over everything.
 *
 * Three layers (same full-screen transparent window):
 *
 *  1. Stream bubble — appears near the cursor as soon as the AI starts
 *     responding. Shows streaming text so the user never looks away.
 *     Auto-hides 8 s after streaming completes if no POINT arrived.
 *
 *  2. Cursor animation — a Mac-style SVG arrow cursor glides from the orb
 *     corner to the AI-identified target coordinate, then ripple rings pulse
 *     at the landing spot.  Only fires when the AI returned a POINT/STEP.
 *
 *  3. Step counter badge (Feature 3) — when the AI returns multi-step STEP
 *     tags, a "Step N / Total" badge with progress dots appears above the
 *     target bubble so the user always knows where they are in the sequence.
 *
 * Coordinate accuracy:
 *   The main process runs a parallel Claude Computer Use API call whose
 *   coordinates are used in preference to the GLM POINT tag.  Both land in
 *   the same display-local logical-pixel space — the overlay window is
 *   positioned to the captured display's bounds so CSS translate(x,y) maps
 *   directly to the correct screen position with no further scaling.
 */

import React, { useEffect, useRef, useState } from 'react'
import type { OrbConfig, PointTarget } from '../../shared/types'

// ── Mac-style arrow cursor SVG ──────────────────────────────────────────────
// Tip is at (0,0) so translate(x,y) positions it exactly at the target.
function CursorSvg({ theme }: { theme: string }): React.ReactElement {
  return (
    <svg width="28" height="34" viewBox="0 0 28 34" fill="none" style={{ display: 'block' }}>
      {/* Drop shadow */}
      <path d="M1.5 2.5 L1.5 24 L7 17.5 L11.5 28.5 L15.5 27 L11 16 L19.5 16 Z" fill="rgba(0,0,0,0.28)" />
      {/* White fill */}
      <path d="M0 0 L0 21.5 L5.5 15 L10 26 L14 24.5 L9.5 13.5 L18 13.5 Z" fill="white" />
      {/* Dark outline */}
      <path d="M0 0 L0 21.5 L5.5 15 L10 26 L14 24.5 L9.5 13.5 L18 13.5 Z" stroke="#111" strokeWidth="1.25" strokeLinejoin="round" />
      {/* Theme-coloured dot at tip */}
      <circle cx="0" cy="0" r="3.5" fill={theme} opacity="0.95" />
    </svg>
  )
}

// ── Bounding highlight box ───────────────────────────────────────────────────
// Drawn around the detected element centre point.  Width/height are a
// reasonable default for typical UI controls (buttons, inputs, links).
const HIGHLIGHT_W = 220
const HIGHLIGHT_H = 52

function HighlightBox({ x, y, theme }: { x: number; y: number; theme: string }): React.ReactElement {
  return (
    <div style={{
      position: 'absolute',
      left:   x - HIGHLIGHT_W / 2,
      top:    y - HIGHLIGHT_H / 2,
      width:  HIGHLIGHT_W,
      height: HIGHLIGHT_H,
      border: `2px solid ${theme}`,
      borderRadius: 9,
      boxShadow: `0 0 0 4px ${theme}28, 0 0 20px 6px ${theme}44`,
      animation: 'highlightPulse 1.6s ease-in-out infinite',
      pointerEvents: 'none',
      zIndex: 54,
    }} />
  )
}

// ── Ripple ring ─────────────────────────────────────────────────────────────
function Ring({ delay, theme }: { delay: number; theme: string }): React.ReactElement {
  return (
    <span style={{
      position: 'absolute', borderRadius: '50%',
      border: `1.5px solid ${theme}`,
      width: 56, height: 56, top: -28, left: -28,
      animation: `orbRipple 1.6s ease-out ${delay}s infinite`,
      pointerEvents: 'none',
    }} />
  )
}

// ── Step counter badge (Feature 3 — multi-step actions) ─────────────────────
function StepBadge({
  stepIndex, stepTotal, theme,
}: { stepIndex: number; stepTotal: number; theme: string }): React.ReactElement {
  return (
    <div style={{
      position: 'absolute',
      top: -44,
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      alignItems: 'center',
      gap: 7,
      background: 'rgba(10,14,20,0.93)',
      border: `1px solid ${theme}44`,
      borderRadius: 20,
      padding: '4px 11px 4px 10px',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
      animation: 'bubbleFadeIn 0.2s ease forwards',
    }}>
      <span style={{
        fontSize: 11,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: theme,
        fontWeight: 700,
        letterSpacing: '0.03em',
      }}>
        Step {stepIndex} / {stepTotal}
      </span>
      {/* Progress dots */}
      <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {Array.from({ length: stepTotal }, (_, i) => (
          <span key={i} style={{
            width: i + 1 === stepIndex ? 8 : 6,
            height: i + 1 === stepIndex ? 8 : 6,
            borderRadius: '50%',
            backgroundColor: i + 1 <= stepIndex ? theme : `${theme}33`,
            transition: 'all 0.3s ease',
            boxShadow: i + 1 === stepIndex ? `0 0 6px 2px ${theme}66` : 'none',
          }} />
        ))}
      </span>
    </div>
  )
}

// ── Streaming text bubble (clicky-style response near cursor) ───────────────
const BUBBLE_W = 280

function StreamBubble({
  x, y, text, theme,
}: { x: number; y: number; text: string; theme: string }): React.ReactElement {
  const bubbleAbove = y > window.innerHeight * 0.55
  const left = Math.min(Math.max(x - 18, 10), window.innerWidth - BUBBLE_W - 10)
  const top  = bubbleAbove ? y - 108 : y + 20

  // While streaming: show last 120 chars with a blinking cursor
  const display = text.length > 120 ? '\u2026' + text.slice(-117) : text

  return (
    <div style={{
      position: 'absolute',
      left, top,
      width: BUBBLE_W,
      padding: '9px 14px',
      borderRadius: 12,
      background: 'rgba(10,14,20,0.97)',
      border: `1.5px solid ${theme}55`,
      backdropFilter: 'blur(14px)',
      WebkitBackdropFilter: 'blur(14px)',
      boxShadow: '0 6px 28px rgba(0,0,0,0.55)',
      color: '#f0f4f8',
      fontSize: 12.5,
      lineHeight: 1.6,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      animation: 'bubbleFadeIn 0.25s ease forwards',
      pointerEvents: 'none',
      zIndex: 70,
    }}>
      {display}
      {/* Blinking cursor at end of streaming text */}
      <span style={{
        display: 'inline-block',
        width: 2, height: '0.95em',
        backgroundColor: theme,
        marginLeft: 2,
        verticalAlign: 'text-bottom',
        animation: 'streamCursor 0.75s step-end infinite',
      }} />
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────
export function App(): React.ReactElement {
  // ── Pointing cursor state ────────────────────────────────────────────────
  const [pointVisible, setPointVisible] = useState(false)
  const [target,       setTarget]       = useState<PointTarget | null>(null)
  const [bubbleText,   setBubbleText]   = useState('')
  const [arrived,      setArrived]      = useState(false)
  const [pos,          setPos]          = useState({ x: 0, y: 0 })
  const [animated,     setAnimated]     = useState(false)
  const arrivalTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Streaming text bubble state ──────────────────────────────────────────
  const [streaming,   setStreaming]  = useState(false)
  const [streamText,  setStreamText] = useState('')
  const [streamPos,   setStreamPos]  = useState({ x: 0, y: 0 })
  const streamHideRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Theme colour ─────────────────────────────────────────────────────────
  const [theme, setTheme] = useState('#10b981')

  useEffect(() => {
    window.api.getOrbConfig().then((cfg: OrbConfig) => setTheme(cfg.theme))

    const subs = [
      window.api.onOrbConfig((cfg: OrbConfig) => setTheme(cfg.theme)),

      // ── Streaming response bubble ──────────────────────────────────────
      window.api.onOverlayResponseStart((pos: { x: number; y: number }) => {
        if (streamHideRef.current) clearTimeout(streamHideRef.current)
        setStreamText('')
        setStreamPos(pos)
        setStreaming(true)
      }),

      window.api.onOverlayResponseChunk((chunk: string) => {
        setStreamText((prev) => prev + chunk)
      }),

      window.api.onOverlayResponseDone(() => {
        // If no POINT arrives within 8 s, hide the stream bubble automatically
        streamHideRef.current = setTimeout(() => setStreaming(false), 8_000)
      }),

      // ── Pointing cursor animation (single step OR each step in multi-step) ──
      window.api.onOverlayPoint((p: PointTarget) => {
        // Hide stream bubble — pointing cursor takes over as response indicator
        if (streamHideRef.current) clearTimeout(streamHideRef.current)
        setStreaming(false)

        if (arrivalTimer.current) clearTimeout(arrivalTimer.current)
        setArrived(false)
        setBubbleText('')

        // Place cursor at bottom-right (near orb), no transition
        const startX = window.innerWidth  - 54
        const startY = window.innerHeight - 54
        setAnimated(false)
        setPos({ x: startX, y: startY })
        setTarget(p)
        setPointVisible(true)

        // Two rAFs ensure the browser paints start position before we animate
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setAnimated(true)
            setPos({ x: p.x, y: p.y })
            arrivalTimer.current = setTimeout(() => setArrived(true), 860)
          })
        })
      }),

      window.api.onOverlayText((t: string) => {
        setBubbleText(t)
      }),

      window.api.onOverlayHide(() => {
        if (arrivalTimer.current) clearTimeout(arrivalTimer.current)
        if (streamHideRef.current) clearTimeout(streamHideRef.current)
        setPointVisible(false)
        setTarget(null)
        setBubbleText('')
        setArrived(false)
        setAnimated(false)
        setStreaming(false)
        setStreamText('')
      }),
    ]
    return () => subs.forEach((u) => u())
  }, [])

  // ── Pointing cursor bubble positioning ──────────────────────────────────
  const label = target?.label || bubbleText
  const bubbleW    = 230
  const bubbleAbove = (target?.y ?? 0) > window.innerHeight * 0.55
  const bubbleLeft  = target ? Math.min(
    Math.max(target.x - bubbleW / 2, 12),
    window.innerWidth - bubbleW - 12,
  ) : 0
  const bubbleTop  = target ? (bubbleAbove ? target.y - 94 : target.y + 34) : 0
  const arrowOffset = target ? Math.min(
    Math.max(target.x - bubbleLeft - 9, 14),
    bubbleW - 28,
  ) : 0

  const isMultiStep = (target?.stepTotal ?? 0) >= 2

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>

      {/* ── Stream bubble: response text near cursor while streaming ──────── */}
      {streaming && streamText && (
        <StreamBubble x={streamPos.x} y={streamPos.y} text={streamText} theme={theme} />
      )}

      {/* ── Pointing cursor ──────────────────────────────────────────────── */}
      {pointVisible && (
        <div style={{
          position: 'absolute', left: 0, top: 0,
          transform: `translate(${pos.x}px, ${pos.y}px)`,
          transition: animated
            ? 'transform 0.86s cubic-bezier(0.22, 1, 0.36, 1)'
            : 'none',
          willChange: 'transform',
          pointerEvents: 'none',
          zIndex: 60,
          filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.45))',
        }}>
          <CursorSvg theme={theme} />
        </div>
      )}

      {/* ── Bounding highlight box around detected element ───────────────── */}
      {pointVisible && arrived && target && (
        <HighlightBox x={target.x} y={target.y} theme={theme} />
      )}

      {/* ── Ripple rings + dot at target ────────────────────────────────── */}
      {pointVisible && arrived && target && (
        <div style={{
          position: 'absolute',
          left: target.x, top: target.y,
          pointerEvents: 'none', zIndex: 55,
        }}>
          <Ring delay={0}    theme={theme} />
          <Ring delay={0.55} theme={theme} />
          <span style={{
            position: 'absolute', borderRadius: '50%',
            backgroundColor: theme,
            width: 9, height: 9, top: -4.5, left: -4.5,
            boxShadow: `0 0 14px 5px ${theme}55`,
            animation: 'dotPulse 2s ease-in-out infinite',
          }} />
        </div>
      )}

      {/* ── Text bubble near target point ───────────────────────────────── */}
      {pointVisible && arrived && label && (
        <div style={{
          position: 'absolute',
          left: bubbleLeft, top: bubbleTop,
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
          maxHeight: 110, overflow: 'hidden',
        }}>
          {/* Step badge — only shown for multi-step sequences (Feature 3) */}
          {isMultiStep && target && target.stepIndex != null && target.stepTotal != null && (
            <StepBadge
              stepIndex={target.stepIndex}
              stepTotal={target.stepTotal}
              theme={theme}
            />
          )}

          {/* Prefer short label; truncate long full-response text */}
          {target?.label || (bubbleText.length > 100
            ? bubbleText.slice(0, bubbleText.lastIndexOf(' ', 100)) + '\u2026'
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

      {/* ── Keyframes ────────────────────────────────────────────────────── */}
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
        @keyframes streamCursor {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        @keyframes highlightPulse {
          0%, 100% { opacity: 1;   }
          50%       { opacity: 0.6; }
        }
      `}</style>
    </div>
  )
}
