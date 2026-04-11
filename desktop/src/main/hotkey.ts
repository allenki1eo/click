/**
 * Global push-to-talk hotkey manager.
 *
 * Ported from GlobalPushToTalkShortcutMonitor.swift (Clicky).
 *
 * Uses Electron's globalShortcut API to listen for hotkeys even when
 * the app window is not focused — essential for a tray companion.
 *
 * Default hotkey: Ctrl+Shift (both keys held) on Windows/Linux
 *                 Cmd+Shift on macOS
 *
 * We register two shortcuts:
 *   - The combined shortcut fires onHotkeyPress on first keydown
 *   - We track release via a timer (globalShortcut can't detect keyup)
 *
 * TODO: For production, replace with iohook for true keydown/keyup events.
 * globalShortcut fires repeatedly while held, so we debounce the press.
 */

import { globalShortcut, BrowserWindow, app } from 'electron'
import type { CompanionManager } from './companion'

const PTT_HOTKEY_WIN_LINUX = 'Control+Shift'
const PTT_HOTKEY_MAC = 'Command+Shift'

interface HotkeyManagerOptions {
  companionManager: CompanionManager
  panelWindow: BrowserWindow
}

export class HotkeyManager {
  private readonly companionManager: CompanionManager
  private readonly panelWindow: BrowserWindow

  /** Whether PTT is currently considered "held" — prevents repeat fires */
  private isHeld = false

  /**
   * Timer that simulates a keyup event.
   * globalShortcut fires every ~30ms while held; we need to detect release.
   * We reset this timer on each fire — when it fires without being reset,
   * we treat it as a release.
   */
  private releaseTimer: ReturnType<typeof setTimeout> | null = null
  private readonly RELEASE_TIMEOUT_MS = 200

  constructor(options: HotkeyManagerOptions) {
    this.companionManager = options.companionManager
    this.panelWindow = options.panelWindow
    this.register()

    // Clean up on quit
    app.on('will-quit', () => this.unregister())
  }

  private register(): void {
    const hotkey = process.platform === 'darwin' ? PTT_HOTKEY_MAC : PTT_HOTKEY_WIN_LINUX

    const registered = globalShortcut.register(hotkey, () => {
      this.onHotkeyFired()
    })

    if (!registered) {
      console.error(`[HotkeyManager] Failed to register hotkey "${hotkey}" — it may be in use by another app`)
    } else {
      console.info(`[HotkeyManager] Registered PTT hotkey: ${hotkey}`)
    }
  }

  private onHotkeyFired(): void {
    if (!this.isHeld) {
      // First fire — treat as keydown
      this.isHeld = true
      this.companionManager.onHotkeyPress()
    }

    // Reset the release timer on every fire.
    // When the user releases the keys, globalShortcut stops firing and the
    // timer expires, which we treat as keyup.
    if (this.releaseTimer) clearTimeout(this.releaseTimer)
    this.releaseTimer = setTimeout(() => {
      if (this.isHeld) {
        this.isHeld = false
        this.companionManager.onHotkeyRelease()
      }
    }, this.RELEASE_TIMEOUT_MS)
  }

  private unregister(): void {
    globalShortcut.unregisterAll()
  }
}
