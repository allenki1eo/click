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

  const model = 'glm-5v-turbo'
  const question = transcript?.trim() || 'What do you see? Give me a brief summary and point to the main interactive element.'
  const personalityHint = PERSONALITY_HINTS[personality ?? 'friendly'] ?? PERSONALITY_HINTS['friendly']

  // For GLM vision models we embed all instructions in the user message
  // (GLM does not reliably follow system prompts).
  // We tell it the coordinate system explicitly so POINT tags are accurate.
  const userText =
    `You are a screen navigation assistant. The screenshot is ${screenWidth}×${screenHeight} pixels ` +
    `(x goes 0=left to ${screenWidth}=right, y goes 0=top to ${screenHeight}=bottom).\n` +
    `Personality: ${personalityHint}\n\n` +
    `MY QUESTION: "${question}"\n\n` +
    `Rules:\n` +
    `1. Answer my SPECIFIC question — do NOT just describe everything you see.\n` +
    `2. Keep your answer under 3 sentences.\n` +
    `3. If pointing to a UI element, append exactly ONE tag at the end:\n` +
    `   [POINT:x,y:element name:screen0]  ← x,y are pixel coords of the element CENTER.\n` +
    `   Example for a button at the middle-right: [POINT:${Math.round(screenWidth * 0.75)},${Math.round(screenHeight * 0.5)}:Submit button:screen0]\n` +
    `4. Only add [POINT:...] when you can identify a specific clickable element to point at.\n` +
    `5. Do NOT add [POINT:...] for general questions that don't need pointing.`

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
    body: JSON.stringify({ model, max_tokens: 800, stream: true, messages }),
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
