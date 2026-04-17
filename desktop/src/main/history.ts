/**
 * Persistent conversation history — saves every Q&A turn to
 * ~/.mwongozo/history.json so context survives app restarts.
 *
 * Format: array of HistoryEntry (newest entries at the end).
 * Capped at MAX_ENTRIES to keep the file small.
 *
 * Thread safety: all writes are synchronous so concurrent calls within
 * the same process are serialised by Node's event loop.
 */

import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import type { HistoryEntry } from '../shared/types'

const HISTORY_DIR  = join(app.getPath('home'), '.mwongozo')
const HISTORY_FILE = join(HISTORY_DIR, 'history.json')
const MAX_ENTRIES  = 300   // ~150 turns — keeps file under ~200 KB

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export function loadHistory(): HistoryEntry[] {
  try {
    if (!existsSync(HISTORY_FILE)) return []
    const raw = readFileSync(HISTORY_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as HistoryEntry[] : []
  } catch (err) {
    console.warn('[history] Failed to load, starting fresh:', err instanceof Error ? err.message : err)
    return []
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/** Appends new entries and persists.  Trims to MAX_ENTRIES automatically. */
export function appendHistory(entries: HistoryEntry[]): void {
  if (!entries.length) return
  try {
    ensureDir()
    const existing = loadHistory()
    const combined  = [...existing, ...entries].slice(-MAX_ENTRIES)
    writeFileSync(HISTORY_FILE, JSON.stringify(combined, null, 2), 'utf-8')
  } catch (err) {
    console.error('[history] Failed to write:', err instanceof Error ? err.message : err)
  }
}

// ---------------------------------------------------------------------------
// Clear
// ---------------------------------------------------------------------------

export function clearHistory(): void {
  try {
    ensureDir()
    writeFileSync(HISTORY_FILE, '[]', 'utf-8')
  } catch (err) {
    console.error('[history] Failed to clear:', err instanceof Error ? err.message : err)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(): void {
  mkdirSync(HISTORY_DIR, { recursive: true })
}
