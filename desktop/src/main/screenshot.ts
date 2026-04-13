/**
 * Screen capture — mirrors CompanionScreenCaptureUtility.swift.
 *
 * Captures the display that contains the cursor (handles multi-monitor).
 * Returns base64 JPEG, logical pixel dimensions, and the display's logical
 * bounds so the overlay window can be repositioned to the same display.
 *
 * We resize the thumbnail to exactly the logical resolution because on HiDPI
 * displays desktopCapturer can return a 2× physical-pixel image even when
 * thumbnailSize is set to the logical resolution.  Coordinates must stay in
 * logical-pixel space so they match the overlay window's CSS coordinate system.
 */

import { desktopCapturer, screen } from 'electron'

export interface Screenshot {
  base64:       string
  width:        number              // logical px
  height:       number              // logical px
  displayBounds: Electron.Rectangle // logical px, for overlay repositioning
}

export async function captureScreen(): Promise<Screenshot> {
  // Use the display that currently has the cursor — handles dual-monitor setups
  const cursor   = screen.getCursorScreenPoint()
  const display  = screen.getDisplayNearestPoint(cursor)
  const { width, height } = display.size          // logical px
  const bounds   = display.bounds                  // {x, y, width, height} logical

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  })

  if (!sources.length) {
    throw new Error('No screen sources — check Screen Recording permission')
  }

  // Find the source that matches the display by comparing bounds
  // Fall back to the first source if no exact match (single-monitor case)
  const source = sources.find((s) => {
    // On some platforms the display_id matches; on others we fall back to index
    return s.display_id === String(display.id)
  }) ?? sources[0]

  // Force to exactly logical resolution
  const thumbnail = source.thumbnail.resize({ width, height })
  const jpeg = thumbnail.toJPEG(92)   // higher quality for better AI readability
  if (!jpeg.length) throw new Error('Screenshot was empty')

  return { base64: jpeg.toString('base64'), width, height, displayBounds: bounds }
}
