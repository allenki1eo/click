/**
 * Claude streaming client — sends screenshot + question to proxy /chat.
 * Streams SSE token-by-token, calling onChunk() for each piece.
 * Returns the full clean text + parsed point/steps.
 *
 * Accuracy & Intelligence enhancements:
 *
 *   1. Active app context — the foreground app name + window title is injected
 *      into the system prompt so answers are relevant to what the user is doing.
 *
 *   2. Screen OCR instruction — the model is explicitly told to read all visible
 *      text (labels, error messages, code, menus) before answering, ensuring it
 *      quotes exact on-screen strings rather than guessing.
 *
 *   3. Multi-step STEP tags — for tasks requiring several clicks (e.g. "open
 *      Settings → Privacy → enable Screen Recording"), the model emits ordered
 *      [STEP:n:x,y:label:screen0] tags which are parsed into a steps[] array
 *      so the overlay can animate each target in sequence.
 */

import { net } from 'electron'
import type { Message, PointTarget } from '../shared/types'
import type { AppContext } from '../main/appContext'
import { formatAppContext } from '../main/appContext'

// ---------------------------------------------------------------------------
// Tag parsers
// ---------------------------------------------------------------------------

// Single-step:  [POINT:x,y:label:screen0]
const POINT_RE      = /\[POINT:(\d+(?:\.\d+)?),(\d+(?:\.\d+)?):([^:\]]+):screen(\d+)\]/gi
const POINT_NONE_RE = /\[POINT:none\]/gi

// Multi-step:   [STEP:1:x,y:label:screen0]
const STEP_RE       = /\[STEP:(\d+):(\d+(?:\.\d+)?),(\d+(?:\.\d+)?):([^:\]]+):screen(\d+)\]/gi

export function parsePointTag(text: string): { clean: string; point: PointTarget | null; steps: PointTarget[] } {
  // Strip [POINT:none]
  const stripped = text.replace(POINT_NONE_RE, '').trim()

  // ── Multi-step STEP tags ────────────────────────────────────────────────
  const stepMatches = [...stripped.matchAll(STEP_RE)]
  if (stepMatches.length > 0) {
    const steps: PointTarget[] = stepMatches
      .map((m) => ({
        stepIndex:   parseInt(m[1], 10),
        x:           Math.round(parseFloat(m[2])),
        y:           Math.round(parseFloat(m[3])),
        label:       m[4].trim(),
        screenIndex: parseInt(m[5], 10),
        stepTotal:   stepMatches.length,
      }))
      .sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0))

    const clean = stripped.replace(STEP_RE, '').replace(/\s{2,}/g, ' ').trim()
    return { clean, point: steps[0] ?? null, steps }
  }

  // ── Single POINT tag ────────────────────────────────────────────────────
  const pointMatches = [...stripped.matchAll(POINT_RE)]
  if (pointMatches.length > 0) {
    const m = pointMatches[0]
    const point: PointTarget = {
      x:           Math.round(parseFloat(m[1])),
      y:           Math.round(parseFloat(m[2])),
      label:       m[3].trim(),
      screenIndex: parseInt(m[4], 10),
    }
    const clean = stripped.replace(POINT_RE, '').replace(/\s{2,}/g, ' ').trim()
    return { clean, point, steps: [point] }
  }

  return { clean: stripped, point: null, steps: [] }
}

// ---------------------------------------------------------------------------
// Streaming guidance call
// ---------------------------------------------------------------------------

const PERSONALITY_HINTS: Record<string, string> = {
  friendly:     'Use a warm, supportive tone — like a helpful friend.',
  professional: 'Be precise and formal. No filler words.',
  playful:      'Be fun and enthusiastic! Use light humour where fitting.',
  concise:      'Be extremely brief — one sentence max if possible.',
}

export async function streamGuidance(opts: {
  screenshotBase64: string
  transcript: string
  history: Message[]
  proxyUrl: string
  screenWidth: number
  screenHeight: number
  personality?: string
  appContext?: AppContext
  onChunk: (text: string) => void
}): Promise<{ text: string; point: PointTarget | null; steps: PointTarget[] }> {
  const {
    screenshotBase64, transcript, history, proxyUrl,
    screenWidth, screenHeight, personality, appContext, onChunk,
  } = opts

  const model    = 'glm-5v-turbo'
  const question = transcript?.trim() || 'What do you see? Give me a brief summary and point to the main interactive element.'
  const personalityHint = PERSONALITY_HINTS[personality ?? 'friendly'] ?? PERSONALITY_HINTS['friendly']

  // ── Active app context block (Feature 1) ─────────────────────────────────
  const appCtxLine = appContext ? formatAppContext(appContext) : ''
  const appCtxBlock = appCtxLine
    ? `ACTIVE APPLICATION: ${appCtxLine}\n` +
      `Use this context to give more specific, targeted guidance.\n\n`
    : ''

  // ── Coordinate anchor grid ────────────────────────────────────────────────
  const W = screenWidth, H = screenHeight
  const coordContext =
    `Screen: ${W}×${H} px. Origin (0,0) is TOP-LEFT. X increases rightward, Y downward.\n` +
    `Anchors → corners: TL=(0,0) TR=(${W},0) BL=(0,${H}) BR=(${W},${H})\n` +
    `Centre=(${W>>1},${H>>1})  Quarter centres: (${W>>2},${H>>2}) (${3*(W>>2)},${H>>2}) (${W>>2},${3*(H>>2)}) (${3*(W>>2)},${3*(H>>2)})\n` +
    `To estimate: decide which quarter the element is in, then refine within it.`

  const userText =
    `You are a screen navigation assistant.\n` +
    `${appCtxBlock}` +
    `${coordContext}\n` +
    `Tone: ${personalityHint}\n\n` +
    `MY QUESTION: "${question}"\n\n` +
    // ── Feature 2: Screen OCR instruction ──────────────────────────────────
    `BEFORE ANSWERING: Carefully read ALL visible text in the screenshot — ` +
    `button labels, menu items, error messages, code, notifications, window titles. ` +
    `Reference exact on-screen text in your answer (quote labels, error strings, etc.).\n\n` +
    `RULES:\n` +
    `1. Answer the question directly and concisely (≤3 sentences).\n` +
    // ── Feature 3: Multi-step STEP tags ────────────────────────────────────
    `2. If the task requires a SINGLE click on a specific UI element, append:\n` +
    `   [POINT:x,y:element name:screen0]\n` +
    `   where x,y = pixel coordinates of element centre using the anchor grid.\n` +
    `   Example: [POINT:${Math.round(W*0.78)},${Math.round(H*0.72)}:Submit button:screen0]\n\n` +
    `3. If the task requires MULTIPLE sequential clicks (e.g. "open Settings → Privacy → enable X"),\n` +
    `   append one tag per step IN ORDER, numbered from 1:\n` +
    `   [STEP:1:x,y:first element:screen0] [STEP:2:x,y:second element:screen0] ...\n` +
    `   Each step must target a VISIBLE element in the current screenshot.\n\n` +
    `4. Use POINT for single-click tasks. Use STEP tags for multi-click workflows.\n` +
    `5. Do NOT add any coordinate tag for purely conceptual / informational questions.\n` +
    `6. Do NOT describe every element on screen — answer the specific question.`

  const currentUserMessage = {
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshotBase64}` } },
      { type: 'text', text: userText },
    ],
  }

  // History holds text-only messages (no images for prior turns)
  const messages: object[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    currentUserMessage,
  ]

  const response = await (net.fetch as typeof fetch)(`${proxyUrl}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 1200, stream: true, messages }),
  })

  if (!response.ok) {
    throw new Error(`Claude proxy error ${response.status}: ${await response.text()}`)
  }

  // Read SSE stream token-by-token
  const reader  = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer    = ''
  let fullText  = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()!   // keep incomplete line

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') break

      try {
        const json  = JSON.parse(data)
        const chunk: string = json.choices?.[0]?.delta?.content ?? ''
        if (chunk) { fullText += chunk; onChunk(chunk) }
      } catch {
        // skip malformed lines
      }
    }
  }

  const { clean, point, steps } = parsePointTag(fullText)
  return { text: clean, point, steps }
}
