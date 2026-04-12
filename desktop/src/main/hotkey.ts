/**
 * Global push-to-talk hotkey — mirrors GlobalPushToTalkShortcutMonitor.swift.
 *
 * Ctrl+Shift+Space (Windows/Linux) / Cmd+Shift+Space (macOS)
 *
 * globalShortcut fires repeatedly while held with no keyup event.
 * We simulate release with a debounce timer: when the shortcut stops
 * firing for RELEASE_MS we treat it as released.
 */

import { globalShortcut, app } from 'electron'
import type { CompanionManager } from './companion'

const HOTKEY = process.platform === 'darwin' ? 'Command+Shift+Space' : 'Control+Shift+Space'
const RELEASE_MS = 200

export class HotkeyManager {
  private isHeld = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private companion: CompanionManager) {
    const ok = globalShortcut.register(HOTKEY, () => this.onFire())
    if (!ok) {
      console.error(`[hotkey] Failed to register ${HOTKEY} — PTT won't work`)
    } else {
      console.info(`[hotkey] Registered: ${HOTKEY}`)
    }
    app.on('will-quit', () => globalShortcut.unregisterAll())
  }

  private onFire(): void {
    if (!this.isHeld) {
      this.isHeld = true
      this.companion.onPress()
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (this.isHeld) {
        this.isHeld = false
        this.companion.onRelease()
      }
    }, RELEASE_MS)
  }
}
