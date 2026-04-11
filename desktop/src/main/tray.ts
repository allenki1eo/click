/**
 * System tray icon and menu manager.
 *
 * Ported from MenuBarPanelManager.swift (Clicky).
 *
 * Responsibilities:
 *  - Create and maintain the system tray icon
 *  - Toggle the panel window on tray icon click
 *  - Position the panel window near the tray icon
 *  - Update the tray icon to reflect CompanionState
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
    // Use a template image (macOS auto-adapts for dark/light menu bar)
    // On Windows we use a 16x16 ICO; fall back to a generated icon in dev
    const iconPath = join(__dirname, '../../resources/tray-icon.png')
    let trayIcon = nativeImage.createFromPath(iconPath)

    if (trayIcon.isEmpty()) {
      // Dev fallback: create a small solid green square as the tray icon
      trayIcon = this.createFallbackIcon()
    }

    this.tray = new Tray(trayIcon)
    this.tray.setToolTip('Mwongozo — AI Navigation Companion')

    // Left-click toggles the panel
    this.tray.on('click', (_, bounds) => {
      this.togglePanel(bounds)
    })

    // Right-click shows context menu
    this.tray.on('right-click', () => {
      this.showContextMenu()
    })
  }

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
   * Position the panel window just above (or below on Windows) the tray icon.
   * Mirrors WindowPositionManager.swift logic.
   */
  private positionPanelNearTray(trayBounds: Electron.Rectangle): void {
    const panelBounds = this.panelWindow.getBounds()
    const primaryDisplay = screen.getPrimaryDisplay()
    const { workAreaSize } = primaryDisplay

    let x = Math.round(trayBounds.x + trayBounds.width / 2 - panelBounds.width / 2)
    let y: number

    // On Windows, tray is at the bottom — open panel above the tray
    // On macOS, tray is at the top — open panel below the tray
    if (process.platform === 'darwin') {
      y = trayBounds.y + trayBounds.height + 4
    } else {
      y = trayBounds.y - panelBounds.height - 4
    }

    // Clamp to screen bounds
    x = Math.max(0, Math.min(x, workAreaSize.width - panelBounds.width))
    y = Math.max(0, Math.min(y, workAreaSize.height - panelBounds.height))

    this.panelWindow.setPosition(x, y)
  }

  private showContextMenu(): void {
    const status = this.companionManager.getStatus()
    const menu = Menu.buildFromTemplate([
      {
        label: status.label_sw,
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'Fungua kidirisha',  // Open panel
        click: () => {
          this.panelWindow.show()
          this.panelWindow.focus()
        }
      },
      {
        label: 'Weka upya',  // Reset
        click: () => this.companionManager.reset()
      },
      { type: 'separator' },
      {
        label: 'Funga / Quit',
        click: () => app.quit()
      }
    ])
    this.tray?.popUpContextMenu(menu)
  }

  /**
   * Updates the tray icon color to reflect the current companion state.
   * Called by CompanionManager whenever state transitions.
   */
  updateStateIndicator(state: CompanionState): void {
    // In production, swap to pre-rendered tinted icons.
    // For now, just update the tooltip so QA can see state changes.
    const labels: Record<CompanionState, string> = {
      idle: 'Mwongozo — Tayari',
      listening: 'Mwongozo — Sikilizando...',
      transcribing: 'Mwongozo — Inabadilisha...',
      processing: 'Mwongozo — Inafikiria...',
      speaking: 'Mwongozo — Inasema...',
      error: 'Mwongozo — Hitilafu'
    }
    this.tray?.setToolTip(labels[state] ?? 'Mwongozo')
  }

  /** Minimal fallback 16x16 tray icon for development when resources aren't built yet */
  private createFallbackIcon(): Electron.NativeImage {
    // Create a 16x16 PNG with a green circle using raw buffer
    // This is purely for dev — production ships real icon assets
    const size = 16
    const png = nativeImage.createFromDataURL(
      `data:image/svg+xml;base64,${Buffer.from(
        `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
        `<circle cx="8" cy="8" r="7" fill="#10b981"/>` +
        `</svg>`
      ).toString('base64')}`
    )
    return png
  }
}
