/**
 * Chat service — SSE streaming to the Mwongozo proxy.
 * Parses [GUIDE:type=query:description] tags from AI responses
 * and fires callbacks so the highlighter can act on them.
 */

const GUIDE_RE = /\[GUIDE:([^\]]+)\]/g;
const HISTORY_KEY = (orgId) => `mwz_history_${orgId}`;
const MAX_HISTORY = 10;

export class ChatService {
  constructor(proxyUrl, orgId) {
    this.proxyUrl = proxyUrl.replace(/\/$/, '');
    this.orgId = orgId;
    this.history = this._loadHistory();
    this.controller = null;
  }

  // Stream a user message; callbacks fired as data arrives
  async stream(userText, pageContext, { onChunk, onDone, onGuide, onError }) {
    // Abort any in-flight request
    if (this.controller) this.controller.abort();
    this.controller = new AbortController();

    const userMsg = { role: 'user', content: buildUserContent(userText, pageContext) };
    const messages = [...this.history, userMsg];

    let fullText = '';

    try {
      const resp = await fetch(`${this.proxyUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Org-Id': this.orgId,
        },
        body: JSON.stringify({
          messages,
          model: 'anthropic/claude-3-haiku',
          stream: true,
          max_tokens: 1000,
        }),
        signal: this.controller.signal,
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Proxy error ${resp.status}: ${err}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete last line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (!delta) continue;

            fullText += delta;
            onChunk?.(delta, fullText);

            // Fire guide callbacks as tags appear in the stream
            let match;
            const searchIn = fullText;
            GUIDE_RE.lastIndex = 0;
            while ((match = GUIDE_RE.exec(searchIn)) !== null) {
              const tag = match[1]; // e.g. "text=Submit:Click to submit"
              const colonIdx = tag.lastIndexOf(':');
              if (colonIdx < 0) continue;
              const query = tag.slice(0, colonIdx);
              const description = tag.slice(colonIdx + 1);
              onGuide?.({ query, description, raw: match[0] });
            }
          } catch (_) { /* malformed SSE chunk */ }
        }
      }

      // Save to history
      const cleanText = fullText.replace(GUIDE_RE, '').trim();
      this.history.push({ role: 'user', content: userText });
      this.history.push({ role: 'assistant', content: cleanText });
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
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY(this.orgId)) || '[]');
    } catch (_) { return []; }
  }

  _saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY(this.orgId), JSON.stringify(this.history));
    } catch (_) { /* storage quota */ }
  }
}

function buildUserContent(text, ctx) {
  if (!ctx) return text;
  const parts = [`User question: ${text}`];
  if (ctx.url) parts.push(`Current page: ${ctx.url}`);
  if (ctx.pageHeading) parts.push(`Page heading: ${ctx.pageHeading}`);
  if (ctx.breadcrumb) parts.push(`Breadcrumb: ${ctx.breadcrumb}`);
  if (ctx.errors?.length) parts.push(`Errors visible: ${ctx.errors.join('; ')}`);
  if (ctx.formFields?.length) {
    const ff = ctx.formFields.map(f => `${f.label}(${f.type})`).join(', ');
    parts.push(`Form fields on page: ${ff}`);
  }
  if (ctx.visibleText) parts.push(`Visible text: ${ctx.visibleText.slice(0, 500)}`);
  return parts.join('\n');
}
