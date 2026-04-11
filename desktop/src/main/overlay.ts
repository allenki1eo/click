/**
 * Overlay window manager.
 *
 * Ported from OverlayWindow.swift (Clicky).
 *
 * The overlay is a full-screen transparent BrowserWindow that sits on top
 * of all other windows (alwaysOnTop: true, focusable: false). It renders
 * the animated cursor pointer and the AI response text bubble.
 *
 * Key constraint: the window must NEVER steal focus. We achieve this with
 * focusable: false and setIgnoreMouseEvents(true, { forward: true }) so
 * all mouse events pass through to the app below.
 */

import { BrowserWindow, ipcMain, screen } from 'electron'
import { IPC } from '../shared/ipc'
import type { PointTarget } from '../shared/types'

export class OverlayManager {
  private readonly overlayWindow: BrowserWindow

  constructor(overlayWindow: BrowserWindow) {
    this.overlayWindow = overlayWindow
    this.sizeToCurrentScreen()
  }

  registerIpcHandlers(): void {
    ipcMain.on(IPC.OVERLAY.SHOW, () => {
      this.sizeToCurrentScreen()
      this.overlayWindow.show()
    })

    ipcMain.on(IPC.OVERLAY.HIDE, () => {
      this.overlayWindow.hide()
    })

    ipcMain.on(IPC.OVERLAY.POINT, (_, point: PointTarget) => {
      this.overlayWindow.webContents.send(IPC.OVERLAY.POINT, point)
    })

    ipcMain.on(IPC.OVERLAY.SET_TEXT, (_, text: string) => {
      this.overlayWindow.webContents.send(IPC.OVERLAY.SET_TEXT, text)
    })
  }

  /**
   * Resize the overlay window to match the primary display dimensions.
   * Called each time we show the overlay so it stays correct after
   * display configuration changes (resolution change, monitor added/removed).
   */
  private sizeToCurrentScreen(): void {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { x, y, width, height } = primaryDisplay.bounds
    this.overlayWindow.setBounds({ x, y, width, height })
  }
}
