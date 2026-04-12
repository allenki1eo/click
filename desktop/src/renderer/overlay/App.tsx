/**
 * Overlay renderer — mirrors OverlayWindow.swift.
 *
 * Full-screen transparent window. Shows:
 *  - An animated green cursor dot at the target (x, y) position
 *  - A text bubble with the AI instruction nearby
 *
 * The window is mouse-transparent (setIgnoreMouseEvents in main/overlay.ts)
 * so it never interferes with the user's workflow.
 */

import React, { useEffect, useState } from 'react'
import type { PointTarget } from '../../shared/types'

interface OverlayState {
  point: PointTarget | null
  text: string
  visible: boolean
}

export function App(): React.ReactElement {
  const [overlay, setOverlay] = useState<OverlayState>({ point: null, text: '', visible: false })

  useEffect(() => {
    const subs = [
      window.api.onOverlayPoint((p) => {
        setOverlay((prev) => ({ ...prev, point: p, visible: true }))
      }),
      window.api.onOverlayText((t) => {
        setOverlay((prev) => ({ ...prev, text: t }))
      }),
      window.api.onOverlayHide(() => {
        setOverlay({ point: null, text: '', visible: false })
      }),
    ]
    return () => subs.forEach((u) => u())
  }, [])

  if (!overlay.visible || !overlay.point) return <></>

  const { x, y, label } = overlay.point
  const bubbleText = label || overlay.text

  // Decide whether bubble appears above or below the cursor
  const bubbleAbove = y > window.innerHeight / 2

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      {/* Cursor dot */}
      <div
        className="absolute"
        style={{ left: x, top: y, transform: 'translate(-50%, -50%)' }}
      >
        {/* Ripple rings */}
        <span className="absolute inline-flex rounded-full bg-green-400 opacity-75 animate-ping"
          style={{ width: 24, height: 24, top: -12, left: -12 }} />
        <span className="absolute inline-flex rounded-full bg-green-500 opacity-50 animate-ping"
          style={{ width: 36, height: 36, top: -18, left: -18, animationDelay: '0.15s' }} />
        {/* Core dot */}
        <span className="relative inline-block rounded-full bg-green-400 shadow-lg"
          style={{ width: 14, height: 14, top: -7, left: -7,
            boxShadow: '0 0 12px 4px rgba(16,185,129,0.6)' }} />
      </div>

      {/* Text bubble */}
      {bubbleText && (
        <div
          className="absolute max-w-xs px-3 py-2 rounded-xl text-sm text-white leading-snug shadow-2xl"
          style={{
            left: Math.min(Math.max(x - 100, 8), window.innerWidth - 230),
            top: bubbleAbove ? y - 12 - 60 : y + 20,
            background: 'rgba(17,24,39,0.92)',
            border: '1px solid rgba(16,185,129,0.4)',
            backdropFilter: 'blur(8px)',
          }}
        >
          {bubbleText}
          {/* Arrow pointing toward cursor */}
          <span
            className="absolute w-0 h-0"
            style={{
              left: Math.min(Math.max(x - Math.min(Math.max(x - 100, 8), window.innerWidth - 230) - 8, 8), 180),
              [bubbleAbove ? 'bottom' : 'top']: -6,
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              [bubbleAbove ? 'borderTop' : 'borderBottom']: '6px solid rgba(17,24,39,0.92)',
            }}
          />
        </div>
      )}
    </div>
  )
}
