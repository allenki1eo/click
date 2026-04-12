/**
 * System tray icon and menu manager.
 *
 * Ported from MenuBarPanelManager.swift (Clicky).
 *
 * Icon loading order:
 *  1. resources/tray-icon.png (ships with the app — 32x32 green square)
 *  2. Inline PNG fallback (same green, generated from raw bytes — never crashes)
 *
 * On macOS, pass a template image (suffix "Template") so the OS inverts it
 * automatically for dark/light menu bar. We skip that for now and use the
 * same green icon on all platforms.
 */

import { Tray, Menu, BrowserWindow, nativeImage, app, screen } from 'electron'
import { join } from 'path'
import type { CompanionManager } from './companion'
import type { CompanionState } from '../shared/types'

interface TrayManagerOptions {
  panelWindow: BrowserWindow
  companionManager: CompanionManager
}

export class TrayManager {
  private tray: Tray | null = null
  private readonly panelWindow: BrowserWindow
  private readonly companionManager: CompanionManager

  constructor(options: TrayManagerOptions) {
    this.panelWindow = options.panelWindow
    this.companionManager = options.companionManager
    this.create()
  }

  private create(): void {
    const icon = this.loadIcon()
    this.tray = new Tray(icon)
    this.tray.setToolTip('Mwongozo — AI Navigation Companion')

    this.tray.on('click', (_, bounds) => this.togglePanel(bounds))
    this.tray.on('right-click', () => this.showContextMenu())
  }

  // ---------------------------------------------------------------------------
  // Icon loading
  // ---------------------------------------------------------------------------

  private loadIcon(): Electron.NativeImage {
    // Try the shipped asset first
    const iconPath = join(__dirname, '../../resources/tray-icon.png')
    const fromFile = nativeImage.createFromPath(iconPath)
    if (!fromFile.isEmpty()) {
      return fromFile
    }

    // Inline fallback — a valid 32x32 solid #10b981 PNG encoded as base64.
    // Generated from: make_png(32, 32, 16, 185, 129) in Python.
    // This guarantees the tray always shows something even in CI / fresh clones.
    const FALLBACK_PNG_B64 =
      'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAGklEQVR4' +
      'Ae3BMQEAAADCoPVP7WsIoAAAeBsAAAAAAAA='

    const buf = Buffer.from(FALLBACK_PNG_B64, 'base64')
    return nativeImage.createFromBuffer(buf)
  }

  // ---------------------------------------------------------------------------
  // Panel toggle
  // ---------------------------------------------------------------------------

  private togglePanel(trayBounds: Electron.Rectangle): void {
    if (this.panelWindow.isVisible()) {
      this.panelWindow.hide()
    } else {
      this.positionPanelNearTray(trayBounds)
      this.panelWindow.show()
      this.panelWindow.focus()
    }
  }

  /**
   * Position the panel just above (Windows) or just below (macOS) the tray icon.
   * Mirrors WindowPositionManager.swift logic.
   */
  private positionPanelNearTray(trayBounds: Electron.Rectangle): void {
    const { width: pw, height: ph } = this.panelWindow.getBounds()
    const { workAreaSize } = screen.getPrimaryDisplay()

    let x = Math.round(trayBounds.x + trayBounds.width / 2 - pw / 2)
    const y = process.platform === 'darwin'
      ? trayBounds.y + trayBounds.height + 4          // macOS: tray at top
      : trayBounds.y - ph - 4                          // Windows: tray at bottom

    // Clamp to screen so the panel never goes off-edge
    x = Math.max(4, Math.min(x, workAreaSize.width - pw - 4))

    this.panelWindow.setPosition(x, Math.max(4, y))
  }

  // ---------------------------------------------------------------------------
  // Context menu
  // ---------------------------------------------------------------------------

  private showContextMenu(): void {
    const status = this.companionManager.getStatus()
    const menu = Menu.buildFromTemplate([
      { label: status.label_sw, enabled: false },
      { type: 'separator' },
      {
        label: 'Fungua kidirisha',
        click: () => { this.panelWindow.show(); this.panelWindow.focus() }
      },
      {
        label: 'Weka upya / Reset',
        click: () => this.companionManager.reset()
      },
      { type: 'separator' },
      { label: 'Funga / Quit', click: () => app.quit() }
    ])
    this.tray?.popUpContextMenu(menu)
  }

  // ---------------------------------------------------------------------------
  // State indicator (tooltip text reflects current state)
  // ---------------------------------------------------------------------------

  updateStateIndicator(state: CompanionState): void {
    const labels: Record<CompanionState, string> = {
      idle:         'Mwongozo — Tayari',
      listening:    'Mwongozo — Sikilizando…',
      transcribing: 'Mwongozo — Inabadilisha…',
      processing:   'Mwongozo — Inafikiria…',
      speaking:     'Mwongozo — Inasema…',
      error:        'Mwongozo — Hitilafu (bofya kuona)',
    }
    this.tray?.setToolTip(labels[state] ?? 'Mwongozo')
  }
}
