/**
 * Conversation analytics logger for Mwongozo proxy.
 * Stores events in memory + persists to analytics.json periodically.
 *
 * Tracked events:
 *   - conversation_start  { orgId, sessionId, page, lang }
 *   - user_message        { orgId, sessionId, text, page }
 *   - assistant_message   { orgId, sessionId, text, guideCount }
 *   - error               { orgId, sessionId, error }
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, 'analytics.json');
const FLUSH_INTERVAL = 30_000; // 30s

// In-memory store: { [orgId]: { events: [], sessions: {} } }
let store = {};

// Load existing data on startup
try {
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  store = JSON.parse(raw);
} catch (_) { /* fresh start */ }

// Periodic flush to disk
setInterval(flushToDisk, FLUSH_INTERVAL);

function ensureOrg(orgId) {
  if (!store[orgId]) store[orgId] = { events: [], sessions: {} };
}

function log(orgId, type, data) {
  ensureOrg(orgId);
  const event = {
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
    type,
    ts: new Date().toISOString(),
    orgId,
    ...data,
  };
  store[orgId].events.push(event);
  // Cap to last 10,000 events per org
  if (store[orgId].events.length > 10_000) {
    store[orgId].events = store[orgId].events.slice(-10_000);
  }
  return event;
}

function logMessage(orgId, sessionId, role, text, meta = {}) {
  log(orgId, role === 'user' ? 'user_message' : 'assistant_message', {
    sessionId,
    text: text.slice(0, 500), // truncate for storage
    ...meta,
  });

  // Update session record
  ensureOrg(orgId);
  if (!store[orgId].sessions[sessionId]) {
    store[orgId].sessions[sessionId] = {
      id: sessionId,
      orgId,
      startedAt: new Date().toISOString(),
      messages: [],
      page: meta.page || '',
      lang: meta.lang || 'en',
    };
  }
  store[orgId].sessions[sessionId].messages.push({ role, text: text.slice(0, 500), ts: new Date().toISOString() });
  store[orgId].sessions[sessionId].lastActivity = new Date().toISOString();
}

function getSummary(orgId) {
  ensureOrg(orgId);
  const events = store[orgId].events;
  const sessions = Object.values(store[orgId].sessions);

  const now = Date.now();
  const DAY = 86_400_000;
  const WEEK = 7 * DAY;
  const MONTH = 30 * DAY;

  const userMsgs = events.filter(e => e.type === 'user_message');
  const inWindow = (e, ms) => now - new Date(e.ts).getTime() < ms;

  // Top questions (most frequent user messages in last 30 days)
  const questionCounts = {};
  userMsgs
    .filter(e => inWindow(e, MONTH))
    .forEach(e => {
      const q = e.text?.toLowerCase().trim().slice(0, 100);
      if (q) questionCounts[q] = (questionCounts[q] || 0) + 1;
    });
  const topQuestions = Object.entries(questionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([text, count]) => ({ text, count }));

  // Conversations per day (last 14 days)
  const byDay = {};
  sessions
    .filter(s => inWindow({ ts: s.startedAt }, 14 * DAY))
    .forEach(s => {
      const day = s.startedAt.slice(0, 10);
      byDay[day] = (byDay[day] || 0) + 1;
    });
  const conversationsPerDay = Object.entries(byDay)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));

  // Pages with most activity
  const pageCounts = {};
  sessions.forEach(s => {
    const p = s.page || 'unknown';
    pageCounts[p] = (pageCounts[p] || 0) + 1;
  });
  const topPages = Object.entries(pageCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([page, count]) => ({ page, count }));

  return {
    totals: {
      conversationsToday:   sessions.filter(s => inWindow({ ts: s.startedAt }, DAY)).length,
      conversationsThisWeek: sessions.filter(s => inWindow({ ts: s.startedAt }, WEEK)).length,
      conversationsThisMonth: sessions.filter(s => inWindow({ ts: s.startedAt }, MONTH)).length,
      totalConversations:   sessions.length,
      totalMessages:        userMsgs.length,
    },
    topQuestions,
    conversationsPerDay,
    topPages,
  };
}

function getRecentConversations(orgId, limit = 50) {
  ensureOrg(orgId);
  return Object.values(store[orgId].sessions)
    .sort((a, b) => new Date(b.lastActivity || b.startedAt) - new Date(a.lastActivity || a.startedAt))
    .slice(0, limit);
}

function flushToDisk() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
  } catch (e) {
    console.error('[analytics] Flush failed:', e.message);
  }
}

module.exports = { log, logMessage, getSummary, getRecentConversations, flushToDisk };
