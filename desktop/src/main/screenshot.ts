/**
 * Screen capture — mirrors CompanionScreenCaptureUtility.swift.
 *
 * Captures the display that contains the cursor (handles multi-monitor).
 * Returns:
 *  • base64     — full logical-resolution JPEG for the GLM vision prompt
 *  • base64Cu   — resized to the closest Anthropic Computer Use resolution
 *                 for the parallel /detect call (more accurate coordinates)
 *  • cursorLocalX/Y — cursor position relative to the captured display's
 *                     top-left corner, so overlay can show text near cursor
 *  • displayBounds  — for repositioning the overlay window
 *
 * Why two resolutions?
 *   The Computer Use API's specialised pixel-counting training is most
 *   accurate when the image is presented at one of Anthropic's recommended
 *   small resolutions whose aspect ratio matches the display.  We pick the
 *   closest from [1024×768, 1280×800, 1366×768] and resize to it.
 *   The GLM vision model benefits from higher resolution, so it keeps the
 *   full logical-pixel image.
 */

import { desktopCapturer, screen } from 'electron'

/** Anthropic-recommended Computer Use resolutions with aspect ratios. */
const CU_RESOLUTIONS = [
  { w: 1024, h: 768  },   // 4:3   = 1.333 — legacy / square-ish displays
  { w: 1280, h: 800  },   // 16:10 = 1.600 — most MacBooks
  { w: 1366, h: 768  },   // ~16:9 = 1.779 — external monitors
]

function bestCuResolution(width: number, height: number): { w: number; h: number } {
  const ratio = width / Math.max(1, height)
  return CU_RESOLUTIONS.reduce((best, r) =>
    Math.abs(r.w / r.h - ratio) < Math.abs(best.w / best.h - ratio) ? r : best
  )
}

export interface Screenshot {
  base64:        string              // full logical-px JPEG  (for GLM vision)
  base64Cu:      string              // CU-resolution JPEG    (for Computer Use)
  width:         number              // logical px
  height:        number              // logical px
  cuWidth:       number              // CU resolution width
  cuHeight:      number              // CU resolution height
  cursorLocalX:  number              // cursor x relative to display top-left
  cursorLocalY:  number              // cursor y relative to display top-left
  displayBounds: Electron.Rectangle  // logical px, for overlay repositioning
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

  // Find the source that matches the display by comparing display ID
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]

  // Force to exactly logical resolution (prevents 2× Retina inflation)
  const thumbnail = source.thumbnail.resize({ width, height })

  // Resize to best Computer Use resolution for parallel element detection
  const cu = bestCuResolution(width, height)
  const thumbnailCu = thumbnail.resize({ width: cu.w, height: cu.h })

  const jpeg   = thumbnail.toJPEG(92)    // high quality for GLM vision
  const jpegCu = thumbnailCu.toJPEG(88)  // slightly lower for CU (smaller payload)

  if (!jpeg.length) throw new Error('Screenshot was empty')

  // Cursor position in display-local coordinates (0-based from display top-left)
  const cursorLocalX = Math.max(0, cursor.x - bounds.x)
  const cursorLocalY = Math.max(0, cursor.y - bounds.y)

  return {
    base64:       jpeg.toString('base64'),
    base64Cu:     jpegCu.toString('base64'),
    width,        height,
    cuWidth:      cu.w,
    cuHeight:     cu.h,
    cursorLocalX, cursorLocalY,
    displayBounds: bounds,
  }
}
