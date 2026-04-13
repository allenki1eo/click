/**
 * Screen capture — mirrors CompanionScreenCaptureUtility.swift.
 *
 * Returns base64 JPEG plus the logical pixel dimensions of the screenshot.
 * We explicitly resize the thumbnail to logical resolution because on HiDPI /
 * Retina displays desktopCapturer can return a 2× or 3× physical-pixel image
 * even when thumbnailSize is set to the logical resolution.  If we let the
 * physical-pixel image through, the AI returns coordinates in physical-pixel
 * space while the overlay window works in logical-pixel space, causing the
 * cursor to point at the wrong position by a factor of the display scale.
 */

import { desktopCapturer, screen } from 'electron'

export interface Screenshot {
  base64: string
  width:  number   // logical pixel width  (matches overlay window)
  height: number   // logical pixel height (matches overlay window)
}

export async function captureScreen(): Promise<Screenshot> {
  const { width, height } = screen.getPrimaryDisplay().size  // logical px

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  })

  if (!sources.length) {
    throw new Error('No screen sources — check Screen Recording permission')
  }

  // Force to exactly logical resolution so AI coordinates stay in logical-pixel
  // space regardless of display scale factor.
  const thumbnail = sources[0].thumbnail.resize({ width, height })
  const jpeg = thumbnail.toJPEG(85)
  if (!jpeg.length) throw new Error('Screenshot was empty')

  return { base64: jpeg.toString('base64'), width, height }
}
