/**
 * Vision guidance service — Qwen2.5-VL primary, Claude fallback.
 *
 * Ported from ClaudeAPI.swift (Clicky). Significantly extended for:
 *  - Dual-model routing (cost saving)
 *  - Flow context injection
 *  - [POINT:x:y:label:screenN] tag parsing
 *  - Confidence-based fallback logic
 *
 * ALL API calls go through the proxy — never directly from the desktop app.
 * The proxy URL is fetched from ConfigManager at call time.
 *
 * Model routing:
 *  1. Try Qwen2.5-VL (free tier via OpenRouter) — fast and cheap
 *  2. If confidence < 0.7 or error → fall back to Claude Sonnet
 *  3. Log which model was used for analytics
 */

import { ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import type { GuidanceResult, FlowContext, PointTarget } from '../shared/types'

// Proxy URL is read from electron-store at runtime — see ConfigManager
let proxyUrl = 'https://mwongozo-proxy.workers.dev'

export function setProxyUrl(url: string): void {
  proxyUrl = url
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(context: FlowContext): string {
  const language = context.language === 'sw' ? 'Swahili' : 'English'
  const stepInfo = context.totalSteps > 0
    ? `CURRENT STEP: ${context.currentStep} of ${context.totalSteps}\nSTEP INSTRUCTION: ${context.stepInstruction}`
    : 'No active flow — provide general navigation assistance.'

  return `You are Mwongozo, an AI navigation guide helping users navigate Tanzanian government portals and business software. You are knowledgeable about TRA IDARS, BRELA, ZSSF, NHIF, and common business software used in Tanzania.

LANGUAGE: Respond in ${language}. Use clear, simple language appropriate for a professional office environment.

CURRENT FLOW: ${context.flowName}
${stepInfo}

${context.orgCustomInstructions ? `ORGANISATION CONTEXT: ${context.orgCustomInstructions}\n` : ''}
RULES:
1. Look at the screenshot carefully. Identify the current state of the screen.
2. Give ONE clear, concise instruction for what to do next.
3. If you can see the exact element to click, embed a POINT tag: [POINT:x:y:label:screen0]
4. Do not overwhelm the user. One action at a time.
5. If the user seems stuck or there is an error visible on screen, acknowledge it and help them fix it.
6. Keep responses under 3 sentences.
7. If the screen matches the expected state for the next step, advance automatically.

RESPONSE FORMAT:
- Text instruction (in ${language})
- Optional: [POINT:x:y:label:screen0] at the END of the response`
}

// ---------------------------------------------------------------------------
// POINT tag parser
// ---------------------------------------------------------------------------

const POINT_TAG_REGEX = /\[POINT:(\d+):(\d+):([^:]+):screen(\d+)\]/g

export function parsePointTags(text: string): { cleanText: string; points: PointTarget[] } {
  const points: PointTarget[] = []
  const cleanText = text.replace(POINT_TAG_REGEX, (_, x, y, label, screenIndex) => {
    points.push({
      x: parseInt(x, 10),
      y: parseInt(y, 10),
      label,
      screenIndex: parseInt(screenIndex, 10)
    })
    return ''
  }).trim()

  return { cleanText, points }
}

// ---------------------------------------------------------------------------
// Qwen2.5-VL call (primary — free)
// ---------------------------------------------------------------------------

async function callQwenVision(
  screenshotBuffer: Buffer,
  userQuery: string,
  context: FlowContext
): Promise<GuidanceResult> {
  const base64Image = screenshotBuffer.toString('base64')
  const systemPrompt = buildSystemPrompt(context)

  const requestBody = {
    model: 'qwen/qwen2.5-vl-72b-instruct:free',
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64Image}` }
          },
          ...(userQuery ? [{ type: 'text', text: userQuery }] : [])
        ]
      }
    ],
    max_tokens: 512,
    temperature: 0.3
  }

  const response = await fetch(`${proxyUrl}/vision/qwen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  })

  if (!response.ok) {
    throw new Error(`Qwen vision proxy error ${response.status}: ${await response.text()}`)
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>
  }

  const rawResponse = data.choices[0]?.message?.content ?? ''
  const { cleanText, points } = parsePointTags(rawResponse)

  // Heuristic confidence: if we got point tags, the model understood the screen well
  // If the response is very short or generic, confidence is lower
  const confidence = points.length > 0 ? 0.9 : rawResponse.length > 50 ? 0.75 : 0.5

  return {
    text: cleanText,
    points,
    confidence,
    modelUsed: 'qwen2.5-vl',
    rawResponse
  }
}

// ---------------------------------------------------------------------------
// Claude Sonnet call (fallback — accurate)
// ---------------------------------------------------------------------------

async function callClaudeVision(
  screenshotBuffer: Buffer,
  userQuery: string,
  context: FlowContext
): Promise<GuidanceResult> {
  const base64Image = screenshotBuffer.toString('base64')
  const systemPrompt = buildSystemPrompt(context)

  const requestBody = {
    model: 'claude-sonnet-4-20250514',
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: base64Image
            }
          },
          ...(userQuery
            ? [{ type: 'text', text: userQuery }]
            : [{ type: 'text', text: 'What should the user do next?' }])
        ]
      }
    ],
    max_tokens: 512
  }

  const response = await fetch(`${proxyUrl}/vision/claude`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  })

  if (!response.ok) {
    throw new Error(`Claude vision proxy error ${response.status}: ${await response.text()}`)
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>
  }

  const rawResponse = data.content.find((b) => b.type === 'text')?.text ?? ''
  const { cleanText, points } = parsePointTags(rawResponse)

  return {
    text: cleanText,
    points,
    // Claude is high-quality fallback — treat as high confidence
    confidence: 0.95,
    modelUsed: 'claude-sonnet',
    rawResponse
  }
}

// ---------------------------------------------------------------------------
// Public entrypoint — implements the routing logic
// ---------------------------------------------------------------------------

export async function getGuidance(
  screenshotBuffer: Buffer,
  userQuery: string,
  context: FlowContext
): Promise<GuidanceResult> {
  // Step 1: Try Qwen (free/cheap)
  try {
    const qwenResult = await callQwenVision(screenshotBuffer, userQuery, context)

    if (qwenResult.confidence >= 0.7) {
      console.info(`[vision] Qwen response accepted (confidence=${qwenResult.confidence})`)
      return qwenResult
    }

    // Low confidence — log and fall through to Claude
    console.warn(
      `[vision] Qwen confidence too low (${qwenResult.confidence}) — falling back to Claude`
    )
  } catch (err) {
    console.error('[vision] Qwen failed, falling back to Claude:', err)
  }

  // Step 2: Fall back to Claude
  console.info('[vision] Using Claude fallback')
  const claudeResult = await callClaudeVision(screenshotBuffer, userQuery, context)
  return claudeResult
}

// ---------------------------------------------------------------------------
// IPC handler (called from companion.ts via ipcMain.handle)
// ---------------------------------------------------------------------------

// Note: vision IPC is registered in CompanionManager since it needs access to
// the screenshot capture and flow context. This module is invoked directly.
