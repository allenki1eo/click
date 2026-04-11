/**
 * Electron main process entry point.
 *
 * Responsibilities:
 *  - Create and manage the three BrowserWindows (panel, overlay, onboarding)
 *  - Initialise companion state machine
 *  - Register all ipcMain handlers (delegated to each module)
 *  - Decide whether to show onboarding or go straight to the tray
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

import { CompanionManager } from './companion'
import { TrayManager } from './tray'
import { OverlayManager } from './overlay'
import { HotkeyManager } from './hotkey'
import { ConfigManager } from './config'
import { registerScreenshotHandlers } from './screenshot'
import { registerAudioHandlers } from './audio'
import { IPC } from '../shared/ipc'

// ---------------------------------------------------------------------------
// Window references — kept module-level so managers can reach them
// ---------------------------------------------------------------------------

let panelWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let onboardingWindow: BrowserWindow | null = null

// ---------------------------------------------------------------------------
// Window factories
// ---------------------------------------------------------------------------

function createPanelWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 360,
    height: 520,
    // Panel is frameless, positioned near the tray icon by TrayManager
    frame: false,
    resizable: false,
    transparent: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/panel/index.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/panel/index.html'))
  }

  // Panel hides instead of closing so it can be re-shown quickly
  win.on('close', (e) => {
    e.preventDefault()
    win.hide()
  })

  return win
}

function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    // Full-screen transparent overlay — sized to the primary display at runtime
    width: 1920,
    height: 1080,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    // Never steals focus — critical for the overlay to not interrupt user work
    focusable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.setIgnoreMouseEvents(true, { forward: true })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay/index.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/overlay/index.html'))
  }

  return win
}

function createOnboardingWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 460,
    height: 580,
    center: true,
    resizable: false,
    frame: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/onboarding/index.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/onboarding/index.html'))
  }

  win.on('ready-to-show', () => win.show())

  return win
}

// ---------------------------------------------------------------------------
// IPC: Window management
// ---------------------------------------------------------------------------

function registerWindowHandlers(): void {
  ipcMain.handle(IPC.WINDOW.SHOW_ONBOARDING, () => {
    if (!onboardingWindow || onboardingWindow.isDestroyed()) {
      onboardingWindow = createOnboardingWindow()
    } else {
      onboardingWindow.show()
      onboardingWindow.focus()
    }
  })

  ipcMain.handle(IPC.WINDOW.CLOSE_ONBOARDING, () => {
    onboardingWindow?.close()
    onboardingWindow = null
  })

  ipcMain.handle(IPC.WINDOW.TOGGLE_PANEL, () => {
    if (panelWindow?.isVisible()) {
      panelWindow.hide()
    } else {
      panelWindow?.show()
      panelWindow?.focus()
    }
  })
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.mwongozo.desktop')

  // Open devtools on F12 in dev, minimise shortcuts otherwise
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Create windows
  panelWindow = createPanelWindow()
  overlayWindow = createOverlayWindow()

  // Wire up managers — order matters: config before companion, tray last
  const configManager = new ConfigManager()
  await configManager.init()

  const companionManager = new CompanionManager({
    panelWindow,
    overlayWindow,
    configManager
  })

  const trayManager = new TrayManager({ panelWindow, companionManager })
  const overlayManager = new OverlayManager(overlayWindow)
  const hotkeyManager = new HotkeyManager({ companionManager, panelWindow })

  // Register IPC handlers
  registerWindowHandlers()
  registerScreenshotHandlers()
  registerAudioHandlers({ companionManager })
  configManager.registerIpcHandlers()
  companionManager.registerIpcHandlers()
  overlayManager.registerIpcHandlers()

  // Start with onboarding if no org profile is stored yet
  const existingProfile = configManager.getStoredProfile()
  if (!existingProfile) {
    onboardingWindow = createOnboardingWindow()
  }

  // Keep the app running in the tray even when all windows are closed
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      panelWindow = createPanelWindow()
    }
  })

  // Suppress external navigation (security: no renderer should open arbitrary URLs)
  app.on('web-contents-created', (_, contents) => {
    contents.on('will-navigate', (event, url) => {
      // Allow dev server hot-reload; block everything else
      if (!is.dev) {
        event.preventDefault()
      }
    })
    contents.setWindowOpenHandler(({ url }) => {
      // Open external links in the system browser, never in a new Electron window
      shell.openExternal(url)
      return { action: 'deny' }
    })
  })
})

// Electron on Windows/Linux quits when all windows are closed — prevent that
// so the app stays alive in the system tray.
app.on('window-all-closed', (e) => {
  // Do NOT quit — the tray keeps the app alive
})
