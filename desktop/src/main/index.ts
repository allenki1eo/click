/**
 * Electron main process entry point.
 *
 * Windows:
 *  • Orb   — small 80×80 transparent circle, bottom-right, always-on-top.
 *            Clicking it toggles the panel.  Eyes track the system cursor.
 *  • Panel — 340×560 chat panel, opens above the orb when clicked.
 *  • Overlay — full-screen transparent window for the cursor pointer animation.
 *
 * The system tray is kept for the right-click "Quit / Reset" menu only.
 */

import { app, BrowserWindow, ipcMain, screen, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { CompanionManager } from './companion'
import { HotkeyManager } from './hotkey'
import { TrayManager } from './tray'
import { createOverlayWindow, resizeOverlayToScreen } from './overlay'
import { IPC } from '../shared/ipc'
import { getOrbConfig, setOrbConfig, getProxyUrl, setProxyUrl, getOrgId, setOrgId } from './config'
import type { OrbConfig } from '../shared/types'

const PRELOAD = join(__dirname, '../preload/index.js')

// ─── layout constants ──────────────────────────────────────────────────────
const ORB_SIZE     = 80   // orb window (square, transparent — orb drawing is inside)
const ORB_MARGIN   = 14   // gap from work-area edges
const PANEL_W      = 340
const PANEL_H      = 560  // taller than before to fit text-input row
const PANEL_GAP    = 8    // gap between orb top and panel bottom

// ─── helpers ───────────────────────────────────────────────────────────────

function getWorkArea(): Electron.Rectangle {
  return screen.getPrimaryDisplay().workArea
}

/** Position of the orb window (never changes unless display changes) */
function orbPosition(): { x: number; y: number } {
  const wa = getWorkArea()
  return {
    x: wa.x + wa.width  - ORB_SIZE   - ORB_MARGIN,
    y: wa.y + wa.height - ORB_SIZE   - ORB_MARGIN,
  }
}

/** Position of the panel so it sits just above the orb, right-aligned */
function panelPosition(orbX: number, orbY: number): { x: number; y: number } {
  const wa = getWorkArea()
  const x  = Math.max(wa.x + 4, orbX + ORB_SIZE - PANEL_W)  // right-align with orb
  const y  = Math.max(wa.y + 4, orbY - PANEL_H - PANEL_GAP)
  return { x, y }
}

// ─── orb window ────────────────────────────────────────────────────────────

function createOrbWindow(): BrowserWindow {
  const pos = orbPosition()

  const win = new BrowserWindow({
    x:           pos.x,
    y:           pos.y,
    width:       ORB_SIZE,
    height:      ORB_SIZE,
    transparent: true,
    frame:       false,
    resizable:   false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow:   false,
    // focusable lets us receive click events; the orb never steals keyboard focus
    // because it immediately hands off to the panel on click.
    focusable:   true,
    webPreferences: {
      preload:          PRELOAD,
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/orb/index.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/orb/index.html'))
  }

  return win
}

// ─── panel window ──────────────────────────────────────────────────────────

function createPanelWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width:       PANEL_W,
    height:      PANEL_H,
    frame:       false,
    resizable:   false,
    transparent: false,
    show:        false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload:          PRELOAD,
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/panel/index.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/panel/index.html'))
  }

  win.on('close', (e) => { e.preventDefault(); win.hide() })
  return win
}

// ─── cursor polling → orb renderer ────────────────────────────────────────

function startCursorTracking(orbWin: BrowserWindow): NodeJS.Timeout {
  return setInterval(() => {
    if (orbWin.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    const bounds = orbWin.getBounds()
    orbWin.webContents.send(IPC.CURSOR_MOVE, {
      cursorX: cursor.x,
      cursorY: cursor.y,
      orbX:    bounds.x,
      orbY:    bounds.y,
      orbW:    bounds.width,
      orbH:    bounds.height,
    })
  }, 16)  // ~60 fps
}

// ─── panel toggle (called from orb click + tray click) ────────────────────

function togglePanel(panelWin: BrowserWindow, orbWin: BrowserWindow): void {
  if (panelWin.isVisible()) {
    panelWin.hide()
  } else {
    const orbBounds = orbWin.getBounds()
    const { x, y }  = panelPosition(orbBounds.x, orbBounds.y)
    panelWin.setPosition(x, y)
    panelWin.show()
    panelWin.focus()
  }
}

// ─── app lifecycle ─────────────────────────────────────────────────────────

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.mwongozo.desktop')
  app.on('browser-window-created', (_, w) => optimizer.watchWindowShortcuts(w))

  const panelWindow   = createPanelWindow()
  const orbWindow     = createOrbWindow()
  const overlayWindow = createOverlayWindow(PRELOAD)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    overlayWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay/index.html`)
  } else {
    overlayWindow.loadFile(join(__dirname, '../renderer/overlay/index.html'))
  }

  // Show orb immediately (it's always visible)
  orbWindow.showInactive()

  const companion = new CompanionManager(panelWindow, overlayWindow)
  new HotkeyManager(companion)
  new TrayManager(panelWindow, companion)

  // Start 60-fps cursor tracking → orb eyes
  const cursorInterval = startCursorTracking(orbWindow)
  app.on('before-quit', () => clearInterval(cursorInterval))

  // Orb click → toggle panel
  ipcMain.on(IPC.ORB_CLICK, () => togglePanel(panelWindow, orbWindow))

  // Legacy toggle-panel IPC (tray / keyboard shortcut)
  ipcMain.handle('window:toggle-panel', () => togglePanel(panelWindow, orbWindow))

  // Orb customisation IPC
  ipcMain.handle(IPC.GET_ORB_CONFIG, () => getOrbConfig())
  ipcMain.handle(IPC.SET_ORB_CONFIG, (_, cfg: Partial<OrbConfig>) => {
    setOrbConfig(cfg)
    const updated = getOrbConfig()
    for (const win of [panelWindow, orbWindow, overlayWindow]) {
      if (!win.isDestroyed()) win.webContents.send(IPC.ORB_CONFIG, updated)
    }
  })

  // Proxy URL IPC
  ipcMain.handle(IPC.GET_PROXY_URL, () => getProxyUrl())
  ipcMain.handle(IPC.SET_PROXY_URL, (_, url: string) => setProxyUrl(url))

  // Org ID (white-labeling)
  ipcMain.handle(IPC.GET_ORG_ID, () => getOrgId())
  ipcMain.handle(IPC.SET_ORG_ID, (_, id: string) => setOrgId(id))

  // Voice transcription — receive base64 audio from renderer, forward to proxy
  ipcMain.handle(IPC.TRANSCRIBE_AUDIO, async (_, b64: string): Promise<string> => {
    const proxy = getProxyUrl()
    const audioBuffer = Buffer.from(b64, 'base64')
    const res = await fetch(`${proxy}/transcribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: audioBuffer,
    })
    const data = await res.json() as { text?: string; error?: string }
    if (!res.ok || data.error) throw new Error(data.error ?? `Proxy error ${res.status}`)
    return data.text ?? ''
  })

  // Re-size overlay + reposition orb if display config changes
  app.on('browser-window-created', () => {
    resizeOverlayToScreen(overlayWindow)
    const pos = orbPosition()
    orbWindow.setPosition(pos.x, pos.y)
  })

  // Security: block external navigation
  app.on('web-contents-created', (_, contents) => {
    contents.on('will-navigate', (e) => { if (!is.dev) e.preventDefault() })
    contents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })
  })
})

app.on('window-all-closed', () => { /* stay alive in tray */ })
