/**
 * OverlayApp — transparent full-screen overlay.
 *
 * Ported from CompanionResponseOverlay.swift + OverlayWindow.swift (Clicky).
 *
 * Renders:
 *  1. An animated cursor pointer that moves to [POINT:x:y] coordinates
 *  2. A floating text bubble showing the AI guidance
 *
 * The window is `pointer-events: none` so it never blocks user interaction.
 *
 * Cursor animation: CSS-based smooth transition to the target point,
 * with a ripple ring that pulses to draw the user's eye.
 */

import React, { useEffect, useRef, useState } from 'react'
import type { PointTarget } from '../../shared/types'

// ---------------------------------------------------------------------------
// Animated cursor pointer
// ---------------------------------------------------------------------------

interface CursorPointerProps {
  x: number
  y: number
  label: string
  visible: boolean
}

function CursorPointer({ x, y, label, visible }: CursorPointerProps): React.ReactElement {
  return (
    <div
      className="absolute transition-all duration-500 ease-out"
      style={{
        left: x - 16,
        top: y - 16,
        opacity: visible ? 1 : 0,
        pointerEvents: 'none'
      }}
    >
      {/* Ripple ring — pulses to attract attention */}
      <div
        className="absolute inset-0 rounded-full animate-ping"
        style={{
          width: 32,
          height: 32,
          backgroundColor: '#10b981',
          opacity: 0.3
        }}
      />
      {/* Outer ring */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          width: 32,
          height: 32,
          border: '2px solid #10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.15)'
        }}
      />
      {/* Center dot */}
      <div
        className="absolute rounded-full"
        style={{
          width: 8,
          height: 8,
          backgroundColor: '#10b981',
          top: 12,
          left: 12,
          boxShadow: '0 0 8px rgba(16, 185, 129, 0.8)'
        }}
      />

      {/* Label bubble */}
      {label && (
        <div
          className="absolute whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium"
          style={{
            top: 36,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#10b981',
            color: '#0a0e17',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            fontFamily: '"DM Sans", sans-serif'
          }}
        >
          {label}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Text bubble
// ---------------------------------------------------------------------------

interface TextBubbleProps {
  text: string
  visible: boolean
}

function TextBubble({ text, visible }: TextBubbleProps): React.ReactElement | null {
  if (!text || !visible) return null

  return (
    <div
      className="fixed transition-all duration-300"
      style={{
        bottom: 48,
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: 480,
        width: 'calc(100% - 64px)',
        opacity: visible ? 1 : 0,
        pointerEvents: 'none'
      }}
    >
      <div
        className="rounded-xl px-4 py-3 text-sm font-medium leading-relaxed"
        style={{
          backgroundColor: 'rgba(17, 24, 39, 0.95)',
          color: '#f9fafb',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          fontFamily: '"DM Sans", sans-serif',
          backdropFilter: 'blur(8px)'
        }}
      >
        {/* Green accent bar on the left */}
        <div
          className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full"
          style={{ backgroundColor: '#10b981', marginLeft: -1 }}
        />
        {text}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main overlay component
// ---------------------------------------------------------------------------

export function OverlayApp(): React.ReactElement {
  const [currentPoint, setCurrentPoint] = useState<PointTarget | null>(null)
  const [guidanceText, setGuidanceText] = useState('')
  const [isVisible, setIsVisible] = useState(false)

  // Auto-hide timer
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const unsubPoint = window.electronAPI.onOverlayPoint((point) => {
      setCurrentPoint(point)
      setIsVisible(true)
      resetHideTimer()
    })

    const unsubText = window.electronAPI.onOverlaySetText((text) => {
      setGuidanceText(text)
      setIsVisible(true)
      resetHideTimer()
    })

    const unsubHide = window.electronAPI.onOverlayHide(() => {
      setIsVisible(false)
      setCurrentPoint(null)
      setGuidanceText('')
    })

    return () => {
      unsubPoint()
      unsubText()
      unsubHide()
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [])

  function resetHideTimer(): void {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    // Auto-hide after 10 seconds if not explicitly hidden
    hideTimerRef.current = setTimeout(() => {
      setIsVisible(false)
    }, 10_000)
  }

  return (
    <div
      className="fixed inset-0"
      style={{ pointerEvents: 'none', backgroundColor: 'transparent' }}
    >
      {/* Cursor pointer */}
      {currentPoint && (
        <CursorPointer
          x={currentPoint.x}
          y={currentPoint.y}
          label={currentPoint.label}
          visible={isVisible}
        />
      )}

      {/* Text bubble */}
      <TextBubble text={guidanceText} visible={isVisible} />
    </div>
  )
}
