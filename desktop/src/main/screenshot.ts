/**
 * Screen capture — mirrors CompanionScreenCaptureUtility.swift.
 * Returns a base64 JPEG of the primary display at native resolution.
 */

import { desktopCapturer, screen } from 'electron'

export async function captureScreen(): Promise<string> {
  const { width, height } = screen.getPrimaryDisplay().size

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  })

  if (!sources.length) {
    throw new Error('No screen sources — check Screen Recording permission')
  }

  const jpeg = sources[0].thumbnail.toJPEG(90)
  if (!jpeg.length) throw new Error('Screenshot was empty')

  return jpeg.toString('base64')
}
