/**
 * Screen capture via Electron's desktopCapturer API.
 *
 * Ported from CompanionScreenCaptureUtility.swift (Clicky).
 *
 * On Windows/macOS/Linux, desktopCapturer returns a list of available
 * screen sources. We grab the primary screen and convert to a PNG buffer.
 *
 * IMPORTANT: desktopCapturer must be called from the MAIN process. The
 * renderer may not have screen-capture permissions, and we want the main
 * process to own all privileged operations.
 */

import { desktopCapturer, ipcMain, screen } from 'electron'
import { IPC } from '../shared/ipc'

/**
 * Capture a JPEG screenshot of the primary display.
 * Returns the image as a base64-encoded string.
 *
 * We use JPEG rather than PNG for vision API calls because:
 *  - Smaller payload → lower latency to the proxy
 *  - Qwen2.5-VL and Claude both accept JPEG natively
 *  - 90% quality is indistinguishable for UI element identification
 */
export async function captureScreenshot(): Promise<string> {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.size

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height }
  })

  if (sources.length === 0) {
    throw new Error('[screenshot] desktopCapturer returned no sources — check screen recording permission')
  }

  // On multi-monitor setups, sources[0] is the primary screen
  const primarySource = sources[0]
  const thumbnail = primarySource.thumbnail

  // Convert NativeImage to base64 JPEG
  const base64Jpeg = thumbnail.toJPEG(90).toString('base64')

  if (!base64Jpeg || base64Jpeg.length === 0) {
    throw new Error('[screenshot] thumbnail was empty — screen capture may be blocked by OS permissions')
  }

  return base64Jpeg
}

/**
 * Capture a specific display by index (for multi-monitor pointing).
 */
export async function captureDisplayByIndex(displayIndex: number): Promise<string> {
  const displays = screen.getAllDisplays()
  const targetDisplay = displays[displayIndex] ?? displays[0]
  const { width, height } = targetDisplay.size

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height }
  })

  const source = sources[displayIndex] ?? sources[0]
  return source.thumbnail.toJPEG(90).toString('base64')
}

// ---------------------------------------------------------------------------
// IPC handler registration
// ---------------------------------------------------------------------------

export function registerScreenshotHandlers(): void {
  // invoke → returns base64 JPEG string of the primary screen
  ipcMain.handle(IPC.SCREENSHOT.CAPTURE, async () => {
    return await captureScreenshot()
  })
}
