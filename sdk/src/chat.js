/**
 * Chat service — SSE streaming to the Mwongozo proxy.
 * Sends page context + user auth context so the AI can give
 * page-aware, role-personalised answers.
 */

const GUIDE_PATTERN = /\[GUIDE:([^\]]+)\]/g;
const HISTORY_KEY = (orgId) => `mwz_history_${orgId}`;
const MAX_HISTORY = 10;

export class ChatService {
  constructor(proxyUrl, orgId) {
    this.proxyUrl   = proxyUrl.replace(/\/$/, '');
    this.orgId      = orgId;
    this.history    = this._loadHistory();
    this.controller = null;
  }

  /**
   * @param {string} userText
   * @param {object|null} pageContext  — from context.js
   * @param {object|null} userContext  — from auth.js (role, name, branch…)
   * @param {{ onChunk, onDone, onGuide, onError }} callbacks
   */
  async stream(userText, pageContext, userContext, { onChunk, onDone, onGuide, onError }) {
    if (this.controller) this.controller.abort();
    this.controller = new AbortController();

    const userMsg   = { role: 'user', content: _buildContent(userText, pageContext, userContext) };
    const messages  = [...this.history, userMsg];
    let fullText    = '';
    let seenGuides  = new Set();

    try {
      const resp = await fetch(`${this.proxyUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Org-Id': this.orgId,
          ...(userContext?.role ? { 'X-User-Role': userContext.role } : {}),
        },
        body: JSON.stringify({
          messages,
          model:      'anthropic/claude-3-haiku',
          stream:     true,
          max_tokens: 1000,
        }),
        signal: this.controller.signal,
      });

      if (!resp.ok) throw new Error(`Proxy ${resp.status}: ${await resp.text()}`);

      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const delta = JSON.parse(data).choices?.[0]?.delta?.content;
            if (!delta) continue;

            fullText += delta;
            onChunk?.(delta, fullText);

            // Fire each GUIDE tag exactly once as it appears (fresh regex each time to avoid shared lastIndex)
            const guideRe = new RegExp(GUIDE_PATTERN.source, 'g');
            let m;
            while ((m = guideRe.exec(fullText)) !== null) {
              if (seenGuides.has(m[0])) continue;
              seenGuides.add(m[0]);
              const colonIdx = m[1].lastIndexOf(':');
              if (colonIdx < 0) continue;
              onGuide?.({
                query:       m[1].slice(0, colonIdx),
                description: m[1].slice(colonIdx + 1),
                raw:         m[0],
              });
            }
          } catch (_) {}
        }
      }

      const cleanText = fullText.replace(new RegExp(GUIDE_PATTERN.source, 'g'), '').trim();
      this.history.push({ role: 'user',      content: userText   });
      this.history.push({ role: 'assistant', content: cleanText  });
      if (this.history.length > MAX_HISTORY * 2) {
        this.history = this.history.slice(-MAX_HISTORY * 2);
      }
      this._saveHistory();
      onDone?.(cleanText, fullText);

    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[mwz chat]', err);
      onError?.(err.message);
    }
  }

  clearHistory() {
    this.history = [];
    this._saveHistory();
  }

  _loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY(this.orgId)) || '[]'); }
    catch (_) { return []; }
  }

  _saveHistory() {
    try { localStorage.setItem(HISTORY_KEY(this.orgId), JSON.stringify(this.history)); }
    catch (_) {}
  }
}

function _buildContent(text, ctx, user) {
  const parts = [`User question: ${text}`];

  // Auth / role context
  if (user) {
    const lines = [];
    if (user.role)       lines.push(`Role: ${user.role}`);
    if (user.name)       lines.push(`Name: ${user.name}`);
    if (user.department) lines.push(`Department: ${user.department}`);
    if (user.branch)     lines.push(`Branch: ${user.branch}`);
    if (lines.length)    parts.push(`User context: ${lines.join(', ')}`);
  }

  // Page context
  if (ctx) {
    if (ctx.url)          parts.push(`Current page: ${ctx.url}`);
    if (ctx.pageHeading)  parts.push(`Page heading: ${ctx.pageHeading}`);
    if (ctx.breadcrumb)   parts.push(`Breadcrumb: ${ctx.breadcrumb}`);
    if (ctx.errors?.length)
      parts.push(`Errors visible: ${ctx.errors.join('; ')}`);
    if (ctx.formFields?.length)
      parts.push(`Form fields: ${ctx.formFields.map(f => `${f.label}(${f.type})`).join(', ')}`);
    if (ctx.visibleText)
      parts.push(`Visible text: ${ctx.visibleText.slice(0, 500)}`);
  }

  return parts.join('\n');
}
