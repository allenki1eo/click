/**
 * Claude streaming client — sends screenshot + question to proxy /chat.
 * Streams SSE token-by-token, calling onChunk() for each piece.
 * Returns the full clean text + parsed POINT coordinates.
 *
 * Screen dimensions are passed so the AI knows the coordinate space and can
 * return accurate pixel positions for the overlay cursor.
 */

import { net } from 'electron'
import type { Message, PointTarget } from '../shared/types'

// ---------------------------------------------------------------------------
// POINT tag parser  [POINT:x,y:label:screen0]
// ---------------------------------------------------------------------------

const POINT_RE      = /\[POINT:(\d+(?:\.\d+)?),(\d+(?:\.\d+)?):([^:]+):screen(\d+)\]/i
const POINT_NONE_RE = /\[POINT:none\]/i

export function parsePointTag(text: string): { clean: string; point: PointTarget | null } {
  const noneMatch = POINT_NONE_RE.exec(text)
  if (noneMatch) return { clean: text.replace(POINT_NONE_RE, '').trim(), point: null }

  const match = POINT_RE.exec(text)
  if (!match) return { clean: text.trim(), point: null }

  return {
    clean: text.replace(POINT_RE, '').trim(),
    point: {
      x: Math.round(parseFloat(match[1])),
      y: Math.round(parseFloat(match[2])),
      label: match[3],
      screenIndex: parseInt(match[4], 10),
    },
  }
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
  onChunk: (text: string) => void
}): Promise<{ text: string; point: PointTarget | null }> {
  const { screenshotBase64, transcript, history, proxyUrl, screenWidth, screenHeight, personality, onChunk } = opts

  const model    = 'glm-5v-turbo'
  const question = transcript?.trim() || 'What do you see? Give me a brief summary and point to the main interactive element.'
  const personalityHint = PERSONALITY_HINTS[personality ?? 'friendly'] ?? PERSONALITY_HINTS['friendly']

  // Anchor grid: gives the model concrete reference points for coordinate accuracy
  const W = screenWidth, H = screenHeight
  const coordContext =
    `Screen: ${W}×${H} px. Origin (0,0) is TOP-LEFT. X increases rightward, Y increases downward.\n` +
    `Anchor points → corners: TL=(0,0) TR=(${W},0) BL=(0,${H}) BR=(${W},${H})\n` +
    `Centre=(${W>>1},${H>>1})  Left-mid=(0,${H>>1})  Right-mid=(${W},${H>>1})  Top-mid=(${W>>1},0)  Bottom-mid=(${W>>1},${H})\n` +
    `Quarter centres: (${W>>2},${H>>2}) (${3*(W>>2)},${H>>2}) (${W>>2},${3*(H>>2)}) (${3*(W>>2)},${3*(H>>2)})\n` +
    `To estimate coordinates: decide which quarter the element is in, then refine within that quarter.`

  const userText =
    `You are a screen navigation assistant.\n` +
    `${coordContext}\n` +
    `Tone: ${personalityHint}\n\n` +
    `MY QUESTION: "${question}"\n\n` +
    `RULES:\n` +
    `1. Answer the question directly and concisely (≤3 sentences).\n` +
    `2. If the answer requires pointing to a specific UI element, append EXACTLY ONE tag:\n` +
    `   [POINT:x,y:element name:screen0]\n` +
    `   where x,y are the pixel coordinates of the element's CENTER — use the anchor grid to be precise.\n` +
    `   Example (button in lower-right quarter): [POINT:${Math.round(W*0.78)},${Math.round(H*0.72)}:Submit button:screen0]\n` +
    `3. Only add [POINT:...] for a specific clickable element the user needs to act on.\n` +
    `4. Do NOT add [POINT:none] or any POINT tag for general questions.\n` +
    `5. Do NOT describe every element on screen — answer the specific question.`

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
    body: JSON.stringify({ model, max_tokens: 1000, stream: true, messages }),
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
    buffer = lines.pop()!  // keep incomplete line

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

  const { clean, point } = parsePointTag(fullText)
  return { text: clean, point }
}
