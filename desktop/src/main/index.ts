/**
 * Electron main process entry point.
 * Creates windows, wires up all managers, stays alive in the tray.
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { CompanionManager } from './companion'
import { HotkeyManager } from './hotkey'
import { TrayManager } from './tray'
import { createOverlayWindow, resizeOverlayToScreen } from './overlay'
import { IPC } from '../shared/ipc'

const PRELOAD = join(__dirname, '../preload/index.js')

// ---------------------------------------------------------------------------
// Panel window (tray dropdown)
// ---------------------------------------------------------------------------

function createPanelWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 340,
    height: 500,
    frame: false,
    resizable: false,
    transparent: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/panel/index.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/panel/index.html'))
  }

  // Hide instead of close so it can be re-shown from the tray
  win.on('close', (e) => { e.preventDefault(); win.hide() })

  return win
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.mwongozo.desktop')

  app.on('browser-window-created', (_, w) => optimizer.watchWindowShortcuts(w))

  const panelWindow  = createPanelWindow()
  const overlayWindow = createOverlayWindow(PRELOAD)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    overlayWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay/index.html`)
  } else {
    overlayWindow.loadFile(join(__dirname, '../renderer/overlay/index.html'))
  }

  const companion = new CompanionManager(panelWindow, overlayWindow)
  new HotkeyManager(companion)
  const tray = new TrayManager(panelWindow, companion)

  // Keep tray tooltip in sync with companion state
  panelWindow.webContents.on('ipc-message', () => {
    tray.updateTooltip(companion.getStatus().state)
  })

  // Re-size overlay if display config changes
  app.on('browser-window-created', () => resizeOverlayToScreen(overlayWindow))

  // Window management IPC
  ipcMain.handle('window:toggle-panel', () => {
    if (panelWindow.isVisible()) panelWindow.hide()
    else { panelWindow.show(); panelWindow.focus() }
  })

  // Security: block all external navigation from renderers
  app.on('web-contents-created', (_, contents) => {
    contents.on('will-navigate', (e) => { if (!is.dev) e.preventDefault() })
    contents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })
  })
})

app.on('window-all-closed', () => { /* stay alive in tray */ })
