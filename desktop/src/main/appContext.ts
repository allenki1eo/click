/**
 * Active application context — detects the foreground app and window title.
 *
 * Used to give the AI richer context about what the user is working on, e.g.:
 *   "Active app: VS Code — App.tsx" → much more targeted guidance than a raw screenshot.
 *
 * Platform support:
 *   macOS — AppleScript via osascript   (no extra deps)
 *   Linux — xdotool                     (sudo apt install xdotool)
 *   Win32 — PowerShell Get-Process
 *
 * Always resolves (never throws) — returns { appName: 'Unknown', windowTitle: '' }
 * on any error so callers don't need try/catch.
 */

import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface AppContext {
  appName:      string
  windowTitle:  string
  filePath?:    string   // best-effort: extracted from window title when recognisable
}

const UNKNOWN: AppContext = { appName: 'Unknown', windowTitle: '' }

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns active app context. Resolves in <200 ms on macOS; never throws. */
export async function getActiveAppContext(): Promise<AppContext> {
  try {
    switch (process.platform) {
      case 'darwin': return await getMacContext()
      case 'linux':  return await getLinuxContext()
      case 'win32':  return await getWindowsContext()
      default:       return UNKNOWN
    }
  } catch (err) {
    console.warn('[appContext] detection failed:', err instanceof Error ? err.message : err)
    return UNKNOWN
  }
}

/** One-line summary for inclusion in AI prompts. */
export function formatAppContext(ctx: AppContext): string {
  if (ctx.appName === 'Unknown') return ''
  let s = ctx.appName
  if (ctx.windowTitle) s += ` — "${ctx.windowTitle}"`
  if (ctx.filePath)    s += ` (file: ${ctx.filePath})`
  return s
}

// ---------------------------------------------------------------------------
// Platform implementations
// ---------------------------------------------------------------------------

async function getMacContext(): Promise<AppContext> {
  // Multi-line AppleScript — get front app name + window title in one call
  const script = [
    'tell application "System Events"',
    '  set fp to first application process whose frontmost is true',
    '  set n to name of fp',
    '  set t to ""',
    '  try',
    '    set t to title of front window of fp',
    '  end try',
    '  return n & "|" & t',
    'end tell',
  ].join('\n')

  const { stdout } = await execAsync(`osascript << 'APPLESCRIPT'\n${script}\nAPPLESCRIPT`, {
    timeout: 2000,
  })

  const parts        = stdout.trim().split('|')
  const appName      = parts[0]?.trim() || 'Unknown'
  const windowTitle  = parts[1]?.trim() || ''
  return { appName, windowTitle, filePath: extractFilePath(windowTitle, appName) }
}

async function getLinuxContext(): Promise<AppContext> {
  // Requires xdotool — soft dependency, fail gracefully
  try {
    const { stdout: idStr } = await execAsync('xdotool getactivewindow', { timeout: 1000 })
    const id = idStr.trim()
    const [clsRes, titleRes] = await Promise.all([
      execAsync(`xdotool getwindowclassname ${id}`, { timeout: 1000 }),
      execAsync(`xdotool getwindowname ${id}`,      { timeout: 1000 }),
    ])
    const appName     = clsRes.stdout.trim()  || 'Unknown'
    const windowTitle = titleRes.stdout.trim() || ''
    return { appName, windowTitle, filePath: extractFilePath(windowTitle, appName) }
  } catch {
    return UNKNOWN   // xdotool not installed or Wayland without XWayland
  }
}

async function getWindowsContext(): Promise<AppContext> {
  const ps = [
    'Get-Process',
    '| Where-Object {$_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne ""}',
    '| Sort-Object CPU -Desc',
    '| Select-Object -First 1',
    '  @{N="n";E={$_.ProcessName}},@{N="t";E={$_.MainWindowTitle}}',
    '| ConvertTo-Json',
  ].join(' ')

  const { stdout } = await execAsync(`powershell -NoProfile -Command "${ps}"`, { timeout: 2500 })
  const data        = JSON.parse(stdout.trim()) as { n?: string; t?: string }
  const appName     = data.n?.trim() || 'Unknown'
  const windowTitle = data.t?.trim() || ''
  return { appName, windowTitle, filePath: extractFilePath(windowTitle, appName) }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a filename / path from common window title patterns.
 *
 * Handles:
 *   "App.tsx — my-project — Visual Studio Code"  → "App.tsx"
 *   "/home/user/script.py — gedit"               → "/home/user/script.py"
 *   "~/projects/app/main.go (modified)"           → "~/projects/app/main.go"
 */
function extractFilePath(title: string, appName: string): string | undefined {
  if (!title) return undefined

  // Absolute path anywhere in title
  const absMatch = title.match(/([/~][\w/\\.\- ]+\.\w{1,10})/)
  if (absMatch) return absMatch[1].trim()

  // VS Code / Sublime pattern: "filename.ext — …" at title start
  const fileMatch = title.match(/^([\w.\-]+\.\w{1,10})\s*[—–\-]/)
  if (fileMatch) return fileMatch[1].trim()

  // IntelliJ / JetBrains: "ProjectName – filename.ext" (note dash direction)
  if (/jetbrains|intellij|pycharm|webstorm|goland|rider/i.test(appName)) {
    const ideMatch = title.match(/[–—]\s*([\w.\-]+\.\w{1,10})\s*$/)
    if (ideMatch) return ideMatch[1].trim()
  }

  return undefined
}
