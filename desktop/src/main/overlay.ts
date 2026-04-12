/**
 * Overlay window manager — mirrors OverlayWindow.swift.
 * Full-screen transparent window, always on top, never steals focus.
 */

import { BrowserWindow, screen, ipcMain } from 'electron'
import { IPC } from '../shared/ipc'

export function createOverlayWindow(preload: string): BrowserWindow {
  const { bounds } = screen.getPrimaryDisplay()

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.setIgnoreMouseEvents(true, { forward: true })
  return win
}

/** Resize overlay to primary display — call when display config changes */
export function resizeOverlayToScreen(win: BrowserWindow): void {
  const { bounds } = screen.getPrimaryDisplay()
  win.setBounds(bounds)
}
