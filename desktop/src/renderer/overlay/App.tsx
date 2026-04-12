/**
 * Overlay renderer — mirrors OverlayWindow.swift.
 *
 * Full-screen transparent window. Shows:
 * - An animated cursor that navigates to the target (x, y) position
 * - A text bubble with the AI instruction nearby
 * - Click effect when cursor reaches the target
 *
 * The window is mouse-transparent (setIgnoreMouseEvents in main/overlay.ts)
 * so it never interferes with the user's workflow.
 */

import React, { useEffect, useState, useRef } from 'react'
import type { PointTarget } from '../../shared/types'

interface OverlayState {
  point: PointTarget | null
  text: string
  visible: boolean
}

interface CursorState {
  x: number
  y: number
  rotation: number
  isAnimating: boolean
  hasReachedTarget: boolean
}

export function App(): React.ReactElement {
  const [overlay, setOverlay] = useState<OverlayState>({ point: null, text: '', visible: false })
  const [cursor, setCursor] = useState<CursorState>({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    rotation: 0,
    isAnimating: false,
    hasReachedTarget: false,
  })
  const animationRef = useRef<number | null>(null)
  const cursorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const subs = [
      window.api.onOverlayPoint((p) => {
        // Start cursor from center of screen
        const startX = window.innerWidth / 2
        const startY = window.innerHeight / 2

        setCursor({
          x: startX,
          y: startY,
          rotation: calculateRotation(startX, startY, p.x, p.y),
          isAnimating: true,
          hasReachedTarget: false,
        })

        setOverlay((prev) => ({ ...prev, point: p, visible: true }))

        // Animate cursor to target
        animateCursorToTarget(startX, startY, p.x, p.y)
      }),
      window.api.onOverlayText((t) => {
        setOverlay((prev) => ({ ...prev, text: t }))
      }),
      window.api.onOverlayHide(() => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current)
          animationRef.current = null
        }
        setOverlay({ point: null, text: '', visible: false })
        setCursor({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
          rotation: 0,
          isAnimating: false,
          hasReachedTarget: false,
        })
      }),
    ]
    return () => subs.forEach((u) => u())
  }, [])

  // Calculate rotation angle for cursor to point toward target
  function calculateRotation(fromX: number, fromY: number, toX: number, toY: number): number {
    const dx = toX - fromX
    const dy = toY - fromY
    return (Math.atan2(dy, dx) * 180) / Math.PI + 90 // +90 because cursor points up by default
  }

  // Animate cursor from start to target with easing
  function animateCursorToTarget(startX: number, startY: number, targetX: number, targetY: number) {
    const duration = 1200 // ms - smooth animation duration
    const startTime = performance.now()
    const rotation = calculateRotation(startX, startY, targetX, targetY)

    // Easing function: easeOutCubic for smooth deceleration
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      const easedProgress = easeOutCubic(progress)

      const currentX = startX + (targetX - startX) * easedProgress
      const currentY = startY + (targetY - startY) * easedProgress

      setCursor({
        x: currentX,
        y: currentY,
        rotation: rotation,
        isAnimating: progress < 1,
        hasReachedTarget: progress >= 1,
      })

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate)
      }
    }

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
    }
    animationRef.current = requestAnimationFrame(animate)
  }

  if (!overlay.visible || !overlay.point) return <></>

  const { x: targetX, y: targetY, label } = overlay.point
  const bubbleText = label || overlay.text

  // Decide whether bubble appears above or below the cursor
  const bubbleAbove = targetY > window.innerHeight / 2

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      {/* Animated Cursor Arrow - Simple and visible */}
      <div
        ref={cursorRef}
        className="absolute z-50"
        style={{
          left: cursor.x,
          top: cursor.y,
          transform: `translate(-50%, -50%) rotate(${cursor.rotation}deg)`,
          pointerEvents: 'none',
        }}
      >
        {/* Simple cursor arrow using CSS shapes - more reliable than SVG */}
        <div
          style={{
            width: 0,
            height: 0,
            borderLeft: '10px solid transparent',
            borderRight: '10px solid transparent',
            borderBottom: '24px solid #10B981',
            filter: 'drop-shadow(2px 2px 3px rgba(0,0,0,0.5))',
          }}
        />
        {/* Cursor outline/highlight */}
        <div
          style={{
            position: 'absolute',
            top: 1,
            left: -9,
            width: 0,
            height: 0,
            borderLeft: '9px solid transparent',
            borderRight: '9px solid transparent',
            borderBottom: '22px solid white',
            zIndex: -1,
          }}
        />

        {/* Cursor trail dots during animation */}
        {cursor.isAnimating && (
          <>
            <span
              className="absolute rounded-full bg-green-400"
              style={{
                width: 10,
                height: 10,
                top: -30,
                left: -5,
                opacity: 0.4,
                animation: 'cursorTrail 0.4s ease-out forwards',
              }}
            />
            <span
              className="absolute rounded-full bg-green-400"
              style={{
                width: 8,
                height: 8,
                top: -50,
                left: -4,
                opacity: 0.3,
                animation: 'cursorTrail 0.5s ease-out forwards',
              }}
            />
            <span
              className="absolute rounded-full bg-green-400"
              style={{
                width: 6,
                height: 6,
                top: -65,
                left: -3,
                opacity: 0.2,
                animation: 'cursorTrail 0.6s ease-out forwards',
              }}
            />
          </>
        )}
      </div>

      {/* Target indicator - shows when cursor reaches destination */}
      {cursor.hasReachedTarget && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: targetX,
            top: targetY,
            transform: 'translate(-50%, -50%)',
          }}
        >
          {/* Ripple effect at target */}
          <span
            className="absolute inline-flex rounded-full bg-green-400 opacity-75 animate-ping"
            style={{ width: 50, height: 50, top: -25, left: -25 }}
          />
          <span
            className="absolute inline-flex rounded-full bg-green-500"
            style={{
              width: 40,
              height: 40,
              top: -20,
              left: -20,
              opacity: 0.5,
              animation: 'targetPulse 1.5s ease-in-out infinite',
              borderRadius: '50%',
            }}
          />
          {/* Target dot */}
          <span
            className="relative inline-block rounded-full bg-green-400"
            style={{
              width: 16,
              height: 16,
              top: -8,
              left: -8,
              boxShadow: '0 0 15px 5px rgba(16,185,129,0.7)',
            }}
          />
        </div>
      )}

      {/* Text bubble */}
      {bubbleText && (
        <div
          className="absolute max-w-xs px-4 py-3 rounded-xl text-sm text-white leading-snug shadow-2xl"
          style={{
            left: Math.min(Math.max(targetX - 100, 8), window.innerWidth - 230),
            top: bubbleAbove ? targetY - 12 - 70 : targetY + 30,
            background: 'rgba(17,24,39,0.95)',
            border: '2px solid rgba(16,185,129,0.6)',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          }}
        >
          {bubbleText}
          {/* Arrow pointing toward cursor */}
          <span
            className="absolute w-0 h-0"
            style={{
              left: Math.min(Math.max(targetX - Math.min(Math.max(targetX - 100, 8), window.innerWidth - 230) - 8, 8), 180),
              [bubbleAbove ? 'bottom' : 'top']: -10,
              borderLeft: '10px solid transparent',
              borderRight: '10px solid transparent',
              [bubbleAbove ? 'borderTop' : 'borderBottom']: '10px solid rgba(17,24,39,0.95)',
            }}
          />
        </div>
      )}

      {/* CSS animations */}
      <style>{`
        @keyframes cursorTrail {
          0% {
            transform: scale(1) translateY(0);
            opacity: 0.5;
          }
          100% {
            transform: scale(0) translateY(-30px);
            opacity: 0;
          }
        }
        @keyframes targetPulse {
          0%, 100% {
            transform: scale(1);
            opacity: 0.5;
          }
          50% {
            transform: scale(1.3);
            opacity: 0.3;
          }
        }
      `}</style>
    </div>
  )
}
