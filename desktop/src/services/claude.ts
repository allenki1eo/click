/**
 * Claude streaming client — mirrors ClaudeAPI.swift.
 *
 * Sends screenshot + transcript to proxy /chat.
 * Streams SSE response token-by-token, calling onChunk() for each piece.
 * Returns the full clean text + parsed POINT coordinates.
 *
 * Conversation history (last 10 turns) is sent with every request so
 * Claude maintains context across PTT interactions, exactly like clicky.
 */

import { net } from 'electron'
import type { Message, PointTarget } from '../shared/types'

// ---------------------------------------------------------------------------
// System prompt — same intent as clicky's companionVoiceResponseSystemPrompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an AI screen assistant. The user has taken a screenshot of their screen and may have spoken a question or request.

Your job:
1. Look at the screenshot carefully and understand what app or website is visible.
2. Answer the user's question or help them with what they need to do next.
3. Be concise — speak naturally, like a helpful colleague. No bullet points, no markdown.
4. If you can identify the exact UI element the user should interact with (a button, field, link), end your response with a POINT tag on its own line: [POINT:x,y:label:screenN]
   - x, y = pixel coordinates of the element's center in the screenshot
   - label = short name of the element
   - N = screen index (use 0 for the primary screen)
   - Only include this if you are confident about the location.
5. If there is nothing to point at, end with: [POINT:none]

Keep responses under 3 sentences. Speak in the language the user spoke in.`

// ---------------------------------------------------------------------------
// POINT tag parser
// ---------------------------------------------------------------------------

const POINT_RE = /\[POINT:(\d+),(\d+):([^:]+):screen(\d+)\]/i
const POINT_NONE_RE = /\[POINT:none\]/i

export function parsePointTag(text: string): { clean: string; point: PointTarget | null } {
  const noneMatch = POINT_NONE_RE.exec(text)
  if (noneMatch) {
    return { clean: text.replace(POINT_NONE_RE, '').trim(), point: null }
  }

  const match = POINT_RE.exec(text)
  if (!match) return { clean: text.trim(), point: null }

  return {
    clean: text.replace(POINT_RE, '').trim(),
    point: {
      x: parseInt(match[1], 10),
      y: parseInt(match[2], 10),
      label: match[3],
      screenIndex: parseInt(match[4], 10),
    },
  }
}

// ---------------------------------------------------------------------------
// Streaming guidance call
// ---------------------------------------------------------------------------

export async function streamGuidance(opts: {
  screenshotBase64: string
  transcript: string
  history: Message[]
  proxyUrl: string
  onChunk: (text: string) => void
}): Promise<{ text: string; point: PointTarget | null }> {
  const { screenshotBase64, transcript, history, proxyUrl, onChunk } = opts

  // Build messages: history (text only) + current turn (image + text)
  const messages: object[] = history.map((m) => ({
    role: m.role,
    content: [{ type: 'text', text: m.content }],
  }))

  messages.push({
    role: 'user',
    content: [
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: screenshotBase64 },
      },
      { type: 'text', text: transcript || 'What should I do next?' },
    ],
  })

  const response = await (net.fetch as typeof fetch)(`${proxyUrl}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      stream: true,
      system: SYSTEM_PROMPT,
      messages,
    }),
  })

  if (!response.ok) {
    throw new Error(`Claude proxy error ${response.status}: ${await response.text()}`)
  }

  // Read SSE stream token-by-token
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()! // keep incomplete line

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') break

      try {
        const json = JSON.parse(data)
        // Anthropic SSE format: content_block_delta → text_delta
        if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
          const chunk: string = json.delta.text ?? ''
          if (chunk) {
            fullText += chunk
            onChunk(chunk)
          }
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  const { clean, point } = parsePointTag(fullText)
  return { text: clean, point }
}
