/**
 * System tray — mirrors MenuBarPanelManager.swift.
 * Green icon, click toggles the panel, right-click shows context menu.
 */

import { Tray, Menu, BrowserWindow, nativeImage, app, screen } from 'electron'
import { join } from 'path'
import type { CompanionManager } from './companion'
import type { CompanionState } from '../shared/types'

export class TrayManager {
  private tray: Tray

  constructor(
    private readonly panelWindow: BrowserWindow,
    private readonly companion: CompanionManager,
  ) {
    this.tray = new Tray(this.loadIcon())
    this.tray.setToolTip('Mwongozo — click the orb in the bottom-right to open')
    // Left-click on tray is a secondary shortcut; right-click shows quit menu
    this.tray.on('click', (_, bounds) => this.togglePanel(bounds))
    this.tray.on('right-click', () => this.showMenu())
  }

  updateTooltip(state: CompanionState): void {
    const labels: Record<CompanionState, string> = {
      idle: 'Mwongozo — Ready',
      listening: 'Mwongozo — Listening…',
      processing: 'Mwongozo — Thinking…',
      responding: 'Mwongozo — Speaking…',
    }
    this.tray.setToolTip(labels[state] ?? 'Mwongozo')
  }

  private togglePanel(trayBounds: Electron.Rectangle): void {
    if (this.panelWindow.isVisible()) {
      this.panelWindow.hide()
    } else {
      this.positionPanel(trayBounds)
      this.panelWindow.show()
      this.panelWindow.focus()
    }
  }

  private positionPanel(trayBounds: Electron.Rectangle): void {
    const { width: pw, height: ph } = this.panelWindow.getBounds()
    const { workAreaSize } = screen.getPrimaryDisplay()
    let x = Math.round(trayBounds.x + trayBounds.width / 2 - pw / 2)
    const y = process.platform === 'darwin'
      ? trayBounds.y + trayBounds.height + 4
      : trayBounds.y - ph - 4
    x = Math.max(4, Math.min(x, workAreaSize.width - pw - 4))
    this.panelWindow.setPosition(x, Math.max(4, y))
  }

  private showMenu(): void {
    const menu = Menu.buildFromTemplate([
      { label: this.companion.getStatus().state, enabled: false },
      { type: 'separator' },
      { label: 'Open panel', click: () => { this.panelWindow.show(); this.panelWindow.focus() } },
      { label: 'Reset conversation', click: () => this.companion.reset() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ])
    this.tray.popUpContextMenu(menu)
  }

  private loadIcon(): Electron.NativeImage {
    const path = join(__dirname, '../../resources/tray-icon.png')
    const img = nativeImage.createFromPath(path)
    if (!img.isEmpty()) return img

    // Inline fallback: 16x16 solid green (#10b981) PNG
    const b64 =
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGElEQVQ4jWNg' +
      'GBhg8n/UwKiBUQOjBgYGABvAAAH/'
    return nativeImage.createFromBuffer(Buffer.from(b64, 'base64'))
  }
}
