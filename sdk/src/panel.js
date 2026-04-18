/**
 * Chat panel component — Shadow DOM floating chat UI.
 * Features: message thread, text input, PTT button, suggested questions,
 * markdown rendering, streaming indicator, clear history.
 */

import { renderMarkdown } from './markdown.js';

export class PanelComponent {
  constructor({ theme, name, welcomeMessage, suggestedQuestions, language }) {
    this.theme = theme || '#00843D';
    this.name = name || 'Msaada';
    this.welcomeMessage = welcomeMessage || 'Habari! Ninaweza kukusaidia?';
    this.suggestedQuestions = suggestedQuestions || [];
    this.language = language || 'sw-en';
    this._visible = false;
    this._host = null;
    this._shadow = null;
    this._onSend = null;
    this._onPttStart = null;
    this._onPttEnd = null;
    this._streamBuffer = '';
  }

  mount(container) {
    this._host = document.createElement('div');
    this._host.id = 'mwz-panel-host';
    Object.assign(this._host.style, {
      position: 'fixed',
      bottom: '104px',
      right: '24px',
      zIndex: '2147483646',
      display: 'none',
    });

    this._shadow = this._host.attachShadow({ mode: 'open' });
    this._shadow.innerHTML = this._template();
    container.appendChild(this._host);

    this._msgList = this._shadow.getElementById('msg-list');
    this._input = this._shadow.getElementById('input');
    this._sendBtn = this._shadow.getElementById('send');
    this._pttBtn = this._shadow.getElementById('ptt');
    this._status = this._shadow.getElementById('status');
    this._clearBtn = this._shadow.getElementById('clear');

    // Send on button click or Enter
    this._sendBtn.addEventListener('click', () => this._handleSend());
    this._input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._handleSend(); }
    });

    // PTT: hold to speak
    const startPtt = () => { this._onPttStart?.(); this._pttBtn.classList.add('recording'); };
    const stopPtt  = () => { this._onPttEnd?.();   this._pttBtn.classList.remove('recording'); };
    this._pttBtn.addEventListener('mousedown',  startPtt);
    this._pttBtn.addEventListener('touchstart', startPtt, { passive: true });
    this._pttBtn.addEventListener('mouseup',    stopPtt);
    this._pttBtn.addEventListener('mouseleave', stopPtt);
    this._pttBtn.addEventListener('touchend',   stopPtt);

    // Clear history
    this._clearBtn.addEventListener('click', () => {
      this._msgList.innerHTML = '';
      this._renderWelcome();
      this._onClear?.();
    });

    // Close button
    this._shadow.getElementById('close').addEventListener('click', () => this.hide());

    this._renderWelcome();
  }

  onSend(cb)     { this._onSend = cb; }
  onPttStart(cb) { this._onPttStart = cb; }
  onPttEnd(cb)   { this._onPttEnd = cb; }
  onClear(cb)    { this._onClear = cb; }

  show() {
    this._visible = true;
    this._host.style.display = 'block';
    this._input.focus();
  }

  hide() {
    this._visible = false;
    this._host.style.display = 'none';
  }

  toggle() { this._visible ? this.hide() : this.show(); }

  addMessage(role, content) {
    this._clearStreaming();
    const el = this._makeMessage(role, content);
    this._msgList.appendChild(el);
    this._scroll();
  }

  // Append streaming chunk to the last assistant bubble
  streamChunk(chunk, full) {
    this._streamBuffer = full;
    let bubble = this._shadow.getElementById('streaming-bubble');
    if (!bubble) {
      bubble = this._makeMessage('assistant', '');
      bubble.id = 'streaming-bubble';
      bubble.querySelector('.msg-content').classList.add('streaming');
      this._msgList.appendChild(bubble);
    }
    const stripped = full.replace(/\[GUIDE:[^\]]+\]/g, '');
    bubble.querySelector('.msg-content').innerHTML = renderMarkdown(stripped) +
      '<span class="cursor">▌</span>';
    this._scroll();
  }

  setStatus(text) {
    if (this._status) this._status.textContent = text;
  }

  setInputEnabled(enabled) {
    if (this._input)   this._input.disabled   = !enabled;
    if (this._sendBtn) this._sendBtn.disabled  = !enabled;
  }

  loadHistory(messages) {
    this._msgList.innerHTML = '';
    this._renderWelcome();
    messages.forEach(m => this.addMessage(m.role, m.content));
  }

  _handleSend() {
    const text = this._input.value.trim();
    if (!text) return;
    this._input.value = '';
    this.addMessage('user', text);
    this._onSend?.(text);
  }

  _clearStreaming() {
    const bubble = this._shadow.getElementById('streaming-bubble');
    if (bubble) {
      bubble.removeAttribute('id');
      bubble.querySelector('.cursor')?.remove();
      bubble.querySelector('.msg-content').classList.remove('streaming');
    }
    this._streamBuffer = '';
  }

  _renderWelcome() {
    const el = this._makeMessage('assistant', this.welcomeMessage);
    this._msgList.appendChild(el);

    if (this.suggestedQuestions.length > 0) {
      const chips = document.createElement('div');
      chips.className = 'chips';
      this.suggestedQuestions.forEach(q => {
        const chip = document.createElement('button');
        chip.className = 'chip';
        chip.textContent = q;
        chip.addEventListener('click', () => {
          this.addMessage('user', q);
          this._onSend?.(q);
        });
        chips.appendChild(chip);
      });
      this._msgList.appendChild(chips);
    }
  }

  _makeMessage(role, content) {
    const wrap = document.createElement('div');
    wrap.className = `msg ${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'msg-content';
    if (role === 'assistant') {
      bubble.innerHTML = renderMarkdown(content.replace(/\[GUIDE:[^\]]+\]/g, ''));
    } else {
      bubble.textContent = content;
    }
    wrap.appendChild(bubble);
    return wrap;
  }

  _scroll() {
    this._msgList.scrollTop = this._msgList.scrollHeight;
  }

  _themeRgb() {
    const hex = this.theme.replace('#', '');
    const r = parseInt(hex.slice(0,2),16);
    const g = parseInt(hex.slice(2,4),16);
    const b = parseInt(hex.slice(4,6),16);
    return `${r},${g},${b}`;
  }

  _template() {
    const rgb = this._themeRgb();
    const inputHint = this.language.startsWith('sw') ? 'Uliza swali...' : 'Ask anything...';
    return `
      <style>
        :host { --c: ${this.theme}; --cr: ${rgb}; }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        .panel {
          width: 340px;
          height: 520px;
          background: #fff;
          border-radius: 16px;
          box-shadow: 0 8px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.1);
          display: flex;
          flex-direction: column;
          font-family: system-ui, -apple-system, sans-serif;
          overflow: hidden;
          animation: mwz-slide-up 0.2s ease;
        }

        @keyframes mwz-slide-up {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* Header */
        .header {
          background: var(--c);
          color: #fff;
          padding: 14px 16px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .header-dot {
          width: 10px; height: 10px;
          background: rgba(255,255,255,0.8);
          border-radius: 50%;
          flex-shrink: 0;
          animation: mwz-dot-pulse 2s ease-in-out infinite;
        }
        @keyframes mwz-dot-pulse {
          0%,100% { opacity: 0.8; }
          50% { opacity: 0.3; }
        }
        .header-name {
          font-size: 15px;
          font-weight: 600;
          flex: 1;
        }
        .header-actions { display: flex; gap: 6px; }
        .icon-btn {
          background: rgba(255,255,255,0.15);
          border: none;
          color: #fff;
          width: 28px; height: 28px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          display: flex; align-items: center; justify-content: center;
          transition: background 0.15s;
        }
        .icon-btn:hover { background: rgba(255,255,255,0.25); }

        /* Status bar */
        #status {
          font-size: 11px;
          color: rgba(var(--cr), 0.7);
          padding: 4px 16px;
          height: 22px;
          background: rgba(var(--cr), 0.05);
          font-style: italic;
        }

        /* Messages */
        #msg-list {
          flex: 1;
          overflow-y: auto;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          scroll-behavior: smooth;
        }
        #msg-list::-webkit-scrollbar { width: 4px; }
        #msg-list::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }

        .msg { display: flex; }
        .msg.user  { justify-content: flex-end; }
        .msg.assistant { justify-content: flex-start; }

        .msg-content {
          max-width: 82%;
          padding: 9px 13px;
          border-radius: 14px;
          font-size: 13.5px;
          line-height: 1.5;
        }
        .msg.user .msg-content {
          background: var(--c);
          color: #fff;
          border-bottom-right-radius: 4px;
        }
        .msg.assistant .msg-content {
          background: #f4f4f5;
          color: #111;
          border-bottom-left-radius: 4px;
        }
        .msg-content p { margin-bottom: 6px; }
        .msg-content p:last-child { margin-bottom: 0; }
        .msg-content ul, .msg-content ol { padding-left: 18px; margin-bottom: 6px; }
        .msg-content code {
          background: rgba(0,0,0,0.07);
          padding: 1px 5px;
          border-radius: 3px;
          font-size: 12px;
        }
        .msg-content pre {
          background: #1e1e2e;
          color: #cdd6f4;
          padding: 10px;
          border-radius: 6px;
          overflow-x: auto;
          font-size: 12px;
        }
        .msg-content strong { font-weight: 600; }
        .msg-content a { color: var(--c); }
        .msg-content blockquote {
          border-left: 3px solid var(--c);
          padding-left: 10px;
          color: #555;
        }
        .cursor { animation: mwz-blink-cur 0.8s step-end infinite; }
        @keyframes mwz-blink-cur { 0%,100% { opacity:1; } 50% { opacity:0; } }

        /* Suggested questions */
        .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 4px 0;
        }
        .chip {
          background: #fff;
          border: 1.5px solid var(--c);
          color: var(--c);
          padding: 4px 10px;
          border-radius: 14px;
          font-size: 12px;
          cursor: pointer;
          font-family: inherit;
          transition: background 0.15s, color 0.15s;
        }
        .chip:hover { background: var(--c); color: #fff; }

        /* Input area */
        .input-area {
          border-top: 1px solid #eee;
          padding: 10px 12px;
          display: flex;
          gap: 8px;
          align-items: center;
        }
        #input {
          flex: 1;
          border: 1.5px solid #e0e0e0;
          border-radius: 10px;
          padding: 8px 12px;
          font-size: 13.5px;
          font-family: inherit;
          outline: none;
          resize: none;
          transition: border-color 0.2s;
          color: #111;
        }
        #input:focus { border-color: var(--c); }
        #input:disabled { background: #f8f8f8; }

        #send {
          background: var(--c);
          border: none;
          color: #fff;
          width: 36px; height: 36px;
          border-radius: 10px;
          cursor: pointer;
          font-size: 18px;
          display: flex; align-items: center; justify-content: center;
          transition: opacity 0.2s;
          flex-shrink: 0;
        }
        #send:disabled { opacity: 0.4; cursor: default; }
        #send:hover:not(:disabled) { opacity: 0.88; }

        #ptt {
          background: #f0f0f0;
          border: none;
          width: 36px; height: 36px;
          border-radius: 10px;
          cursor: pointer;
          font-size: 16px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
          transition: background 0.15s;
          touch-action: none;
        }
        #ptt.recording { background: #fee2e2; }
        #ptt:hover { background: #e8e8e8; }
      </style>

      <div class="panel">
        <div class="header">
          <div class="header-dot"></div>
          <span class="header-name">${this.name}</span>
          <div class="header-actions">
            <button class="icon-btn" id="clear" title="Clear conversation">↺</button>
            <button class="icon-btn" id="close" title="Close">✕</button>
          </div>
        </div>
        <div id="status"></div>
        <div id="msg-list"></div>
        <div class="input-area">
          <button id="ptt" title="Hold to speak">🎙</button>
          <input id="input" type="text" placeholder="${inputHint}" autocomplete="off">
          <button id="send">↑</button>
        </div>
      </div>
    `;
  }
}
