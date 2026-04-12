/**
 * Global push-to-talk hotkey manager.
 *
 * Ported from GlobalPushToTalkShortcutMonitor.swift (Clicky).
 *
 * Uses Electron's globalShortcut API to listen for hotkeys even when
 * the app window is not focused — essential for a tray companion.
 *
 * Hotkey: Ctrl+Shift+Space (Windows/Linux) / Cmd+Shift+Space (macOS)
 *
 * NOTE: Electron globalShortcut requires at least one non-modifier key.
 * "Control+Shift" alone is invalid and silently fails to register.
 * Space is unambiguous and unlikely to conflict with other apps.
 *
 * Push-to-talk mechanic:
 *   - First fire  → onHotkeyPress  (start listening)
 *   - Key release → onHotkeyRelease (stop + process)
 *
 * globalShortcut fires repeatedly while held (~30ms interval) with no
 * keyup event. We simulate release with a debounce timer: when the
 * shortcut stops firing for RELEASE_TIMEOUT_MS we treat it as released.
 *
 * TODO: Replace with iohook for true keydown/keyup events in production.
 */

import { globalShortcut, app } from 'electron'
import type { CompanionManager } from './companion'

const PTT_HOTKEY_WIN_LINUX = 'Control+Shift+Space'
const PTT_HOTKEY_MAC = 'Command+Shift+Space'

export class HotkeyManager {
  private readonly companionManager: CompanionManager
  private isHeld = false
  private releaseTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * How long (ms) after the last shortcut fire before we consider the key
   * released. Must be longer than the OS key-repeat interval (~30ms) but
   * short enough to feel responsive. 200ms is the sweet spot.
   */
  private readonly RELEASE_TIMEOUT_MS = 200

  constructor(companionManager: CompanionManager) {
    this.companionManager = companionManager
    this.register()
    app.on('will-quit', () => this.unregister())
  }

  private register(): void {
    const hotkey = process.platform === 'darwin' ? PTT_HOTKEY_MAC : PTT_HOTKEY_WIN_LINUX

    const ok = globalShortcut.register(hotkey, () => this.onFired())

    if (!ok) {
      // Log clearly — a silent failure here means PTT simply never works
      console.error(
        `[HotkeyManager] Failed to register "${hotkey}". ` +
        `Another app may have claimed it. PTT will not work.`
      )
    } else {
      console.info(`[HotkeyManager] PTT hotkey registered: ${hotkey}`)
    }
  }

  private onFired(): void {
    if (!this.isHeld) {
      this.isHeld = true
      this.companionManager.onHotkeyPress()
    }

    // Reset the release timer on every repeated fire.
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
