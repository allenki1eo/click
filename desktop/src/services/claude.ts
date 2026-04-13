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
// System prompt — guides AI on how to respond
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a screen navigation assistant. The user shows you a screenshot and asks a question.

CRITICAL: You must answer the user's SPECIFIC question. Do NOT just describe the screen.

If user asks "Where is X?" → Find X and point to it.
If user asks "How do I..." → Explain the steps and point to relevant elements.
If user asks "What is this?" → Explain the app/website they see.

RESPONSE FORMAT:
1. Answer the question directly
2. Point to the relevant UI element with: [POINT:x,y:label:screen0]
   - x,y = coordinates of the element CENTER
   - label = what to click (e.g., "Submit button", "Login link")
   - Only include this if you found the element

Example: "Click the blue Submit button at the bottom. [POINT:400,500:Submit button:screen0]"

Keep responses under 3 sentences. Be specific and actionable.`

// BigModel (GLM) doesn't use system prompts well, so we include instructions in the user message
const USER_INSTRUCTIONS = `I am looking at this screenshot. I need your help to navigate.

When you respond:
1. Answer my specific question (don't just describe what you see)
2. If showing me where to click, end your response with: [POINT:x,y:element_name:screen0]

Look at the screenshot and help me with what I asked.`

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

  const model = 'glm-5v-turbo'
  const isBigModel = model.includes('glm')

  // Build user message with screenshot and question
  const userQuestion = transcript?.trim() || 'What should I do next?'

  // For BigModel, we put instructions directly in the user message
  // because GLM doesn't respect system prompts
  const userContentText = isBigModel
    ? `${USER_INSTRUCTIONS}\n\nMY QUESTION: "${userQuestion}"\n\nAnswer my question directly based on the screenshot above.`
    : `The user asked: "${userQuestion}"\n\nBased on the screenshot above, provide guidance on what they should click or do next.`

  // Build messages - for BigModel, we skip the system message
  let messages: object[] = []

  if (isBigModel) {
    // BigModel works best with just user/assistant messages, no system
    // We include instructions in the first user message
    messages = [
      // Add history (without system messages)
      ...history.map((m) => ({ role: m.role, content: m.content })),
      // Current turn with screenshot + instructions + question
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${screenshotBase64}` },
          },
          { type: 'text', text: userContentText },
        ],
      },
    ]
  } else {
    // OpenRouter models use standard system prompt
    messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${screenshotBase64}` },
          },
          { type: 'text', text: userContentText },
        ],
      },
    ]
  }

  const response = await (net.fetch as typeof fetch)(`${proxyUrl}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      stream: true,
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
        const chunk: string = json.choices?.[0]?.delta?.content ?? ''
        if (chunk) {
          fullText += chunk
          onChunk(chunk)
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  const { clean, point } = parsePointTag(fullText)
  return { text: clean, point }
}
