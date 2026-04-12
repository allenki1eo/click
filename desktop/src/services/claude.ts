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

const SYSTEM_PROMPT = `You are Mwongozo, an AI screen assistant that helps users navigate their computer visually. You are viewing the user's screen through a screenshot and listening to their voice commands.

Your job:
1. Analyze the screenshot to identify what app, website, or interface is visible. Read text, buttons, menus, and UI elements carefully.

2. Understand the user's question or request from their transcribed speech. They may ask:
   - "Where is the save button?" → Point to it
   - "How do I log in?" → Guide them to the login button/field
   - "What should I click?" → Identify the most relevant element
   - "What is this?" → Explain what you see
   - Specific actions like "Click the settings icon" → Point to settings

3. Be specific and helpful:
   - Identify exact UI elements by name (e.g., "Submit button", "Search bar", "Menu icon")
   - Reference visual cues you see (colors, icons, text labels)
   - Explain WHY this element is what they need

4. Provide exact coordinates for pointing:
   If you identify the UI element the user should interact with, end your response with a POINT tag on its own line: [POINT:x,y:label:screenN]
   - x, y = pixel coordinates of the element's CENTER in the screenshot
   - label = descriptive name of the element (e.g., "Submit button", "Search input", "Profile icon")
   - N = screen index (use 0 for the primary screen)
   - Only include if confident about the location
   - For icons/buttons without text, describe what they look like

5. If there is nothing to point at, end with: [POINT:none]

Guidelines:
- Be conversational and natural, like a helpful colleague sitting next to them
- Keep responses under 3 sentences
- Speak in the language the user spoke in
- If the user asks "what is this?", explain what app/website they're viewing
- If the user asks "how do I...", provide step-by-step visual guidance
- Use the label in the POINT tag to tell them what to click on

Example good responses:
- "Click the blue 'Submit' button at the bottom of the form. [POINT:450,680:Submit button:screen0]"
- "The settings icon is in the top-right corner, looks like a gear. [POINT:1200,45:Settings gear icon:screen0]"
- "You need to click the green 'New Project' button to get started. [POINT:200,150:New Project button:screen0]"

Always provide clear, actionable guidance that helps the user understand both WHAT to click and WHY.`

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

  // Build messages in OpenAI format (OpenRouter-compatible)
  // History messages are text-only; current turn includes the screenshot
  const userMessageText = transcript?.trim()
    ? `The user asked: "${transcript}"\n\nBased on the screenshot above, provide guidance on what they should click or do next.`
    : 'What should I do next? Analyze the current screen and suggest the next action.'

  const messages: object[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${screenshotBase64}` },
        },
        { type: 'text', text: userMessageText },
      ],
    },
  ]

  const response = await (net.fetch as typeof fetch)(`${proxyUrl}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'anthropic/claude-3.7-sonnet',
      max_tokens: 1024,
      stream: true,
      messages,
    }),
  })

  if (!response.ok) {
    throw new Error(`Claude proxy error ${response.status}: ${await response.text()}`)
  }

  // Read SSE stream token-by-token (OpenAI-compatible format)
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
        // OpenAI SSE format: choices[0].delta.content
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
