/**
 * Chat panel component — Shadow DOM floating chat UI.
 * Features: message thread, text input, PTT, suggested questions,
 * markdown rendering, streaming, language toggle (SW ↔ EN).
 */

import { renderMarkdown }         from './markdown.js';
import { STRINGS, t, saveLang }   from './i18n.js';

export class PanelComponent {
  constructor({ theme, name, welcomeMessage, suggestedQuestions, language }) {
    this.theme = theme || '#00843D';
    this.name  = name  || 'Msaada';
    this.welcomeMessage    = welcomeMessage    || 'Habari! Ninaweza kukusaidia?';
    this.suggestedQuestions = suggestedQuestions || [];
    this.lang  = language?.startsWith('sw') ? 'sw' : 'en';

    this._visible      = false;
    this._host         = null;
    this._shadow       = null;
    this._onSend       = null;
    this._onPttStart   = null;
    this._onPttEnd     = null;
    this._onClear      = null;
    this._onLangChange = null;
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

    this._msgList  = this._shadow.getElementById('msg-list');
    this._input    = this._shadow.getElementById('input');
    this._sendBtn  = this._shadow.getElementById('send');
    this._pttBtn   = this._shadow.getElementById('ptt');
    this._statusEl = this._shadow.getElementById('status');
    this._clearBtn = this._shadow.getElementById('clear');
    this._langBtn  = this._shadow.getElementById('lang-toggle');

    this._sendBtn.addEventListener('click', () => this._handleSend());
    this._input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._handleSend(); }
    });

    const pttStart = () => { this._onPttStart?.(); this._pttBtn.classList.add('recording'); };
    const pttStop  = () => { this._onPttEnd?.();   this._pttBtn.classList.remove('recording'); };
    this._pttBtn.addEventListener('mousedown',  pttStart);
    this._pttBtn.addEventListener('touchstart', pttStart, { passive: true });
    this._pttBtn.addEventListener('mouseup',    pttStop);
    this._pttBtn.addEventListener('mouseleave', pttStop);
    this._pttBtn.addEventListener('touchend',   pttStop);

    this._clearBtn.addEventListener('click', () => {
      this._msgList.innerHTML = '';
      this._renderWelcome();
      this._onClear?.();
    });

    this._shadow.getElementById('close').addEventListener('click', () => this.hide());

    this._langBtn.addEventListener('click', () => {
      this.lang = this.lang === 'sw' ? 'en' : 'sw';
      saveLang(this.lang);
      this._applyLang();
      this._onLangChange?.(this.lang);
    });

    this._applyLang();
    this._renderWelcome();
  }

  // --- Public API ---

  onSend(cb)       { this._onSend = cb; }
  onPttStart(cb)   { this._onPttStart = cb; }
  onPttEnd(cb)     { this._onPttEnd = cb; }
  onClear(cb)      { this._onClear = cb; }
  onLangChange(cb) { this._onLangChange = cb; }

  show()   { this._visible = true;  this._host.style.display = 'block'; this._input?.focus(); }
  hide()   { this._visible = false; this._host.style.display = 'none'; }
  toggle() { this._visible ? this.hide() : this.show(); }

  setLang(lang) {
    this.lang = lang === 'sw' ? 'sw' : 'en';
    this._applyLang();
  }

  addMessage(role, content) {
    this._clearStreaming();
    this._msgList.appendChild(this._makeMessage(role, content));
    this._scroll();
  }

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
    bubble.querySelector('.msg-content').innerHTML =
      renderMarkdown(stripped) + '<span class="cursor">▌</span>';
    this._scroll();
  }

  setStatus(key) {
    if (!this._statusEl) return;
    // Accept either a translation key or a raw string
    this._statusEl.textContent = STRINGS[this.lang]?.[key] ?? key ?? '';
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

  // --- Private ---

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
      bubble.querySelector('.msg-content')?.classList.remove('streaming');
    }
    this._streamBuffer = '';
  }

  _renderWelcome() {
    this._msgList.appendChild(this._makeMessage('assistant', this.welcomeMessage));

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
    const wrap   = document.createElement('div');
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

  _applyLang() {
    if (!this._shadow) return;
    const s = this.lang;
    if (this._input)    this._input.placeholder   = t(s, 'inputHint');
    if (this._clearBtn) this._clearBtn.title       = t(s, 'clearTitle');
    if (this._pttBtn)   this._pttBtn.title         = t(s, 'pttTitle');
    if (this._sendBtn)  this._sendBtn.title        = t(s, 'sendTitle');
    if (this._langBtn)  this._langBtn.textContent  = t(s, 'langToggle');
    const close = this._shadow.getElementById('close');
    if (close) close.title = t(s, 'closeTitle');
  }

  _scroll() { this._msgList.scrollTop = this._msgList.scrollHeight; }

  _rgb() {
    const hex = this.theme.replace('#','');
    return `${parseInt(hex.slice(0,2),16)},${parseInt(hex.slice(2,4),16)},${parseInt(hex.slice(4,6),16)}`;
  }

  _template() {
    const rgb = this._rgb();
    return `
      <style>
        :host { --c: ${this.theme}; --rgb: ${rgb}; }
        * { box-sizing: border-box; margin: 0; padding: 0; }

        .panel {
          width: 340px; height: 520px;
          background: #fff;
          border-radius: 16px;
          box-shadow: 0 8px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.1);
          display: flex; flex-direction: column;
          font-family: system-ui, -apple-system, sans-serif;
          overflow: hidden;
          animation: mwz-slide-up 0.2s ease;
        }
        @keyframes mwz-slide-up {
          from { opacity:0; transform:translateY(12px); }
          to   { opacity:1; transform:translateY(0); }
        }

        .header {
          background: var(--c); color: #fff;
          padding: 14px 16px;
          display: flex; align-items: center; gap: 10px;
        }
        .header-dot {
          width:10px; height:10px;
          background:rgba(255,255,255,0.8); border-radius:50%; flex-shrink:0;
          animation: mwz-dot 2s ease-in-out infinite;
        }
        @keyframes mwz-dot { 0%,100%{opacity:.8} 50%{opacity:.3} }
        .header-name { font-size:15px; font-weight:600; flex:1; }
        .header-actions { display:flex; gap:5px; }

        .icon-btn {
          background:rgba(255,255,255,0.15); border:none; color:#fff;
          width:28px; height:28px; border-radius:6px;
          cursor:pointer; font-size:12px; font-weight:600;
          display:flex; align-items:center; justify-content:center;
          transition:background .15s; font-family:inherit;
        }
        .icon-btn:hover { background:rgba(255,255,255,0.28); }

        /* Status */
        #status {
          font-size:11px; color:rgba(var(--rgb),.75);
          padding:3px 16px; min-height:20px;
          background:rgba(var(--rgb),.05); font-style:italic;
        }

        /* Messages */
        #msg-list {
          flex:1; overflow-y:auto;
          padding:12px 14px; display:flex; flex-direction:column; gap:8px;
          scroll-behavior:smooth;
        }
        #msg-list::-webkit-scrollbar { width:4px; }
        #msg-list::-webkit-scrollbar-thumb { background:#ddd; border-radius:2px; }

        .msg { display:flex; }
        .msg.user      { justify-content:flex-end; }
        .msg.assistant { justify-content:flex-start; }

        .msg-content {
          max-width:82%; padding:9px 13px; border-radius:14px;
          font-size:13.5px; line-height:1.5;
        }
        .msg.user .msg-content {
          background:var(--c); color:#fff; border-bottom-right-radius:4px;
        }
        .msg.assistant .msg-content {
          background:#f4f4f5; color:#111; border-bottom-left-radius:4px;
        }
        .msg-content p { margin-bottom:6px; }
        .msg-content p:last-child { margin-bottom:0; }
        .msg-content ul, .msg-content ol { padding-left:18px; margin-bottom:6px; }
        .msg-content code {
          background:rgba(0,0,0,.07); padding:1px 5px;
          border-radius:3px; font-size:12px;
        }
        .msg-content pre {
          background:#1e1e2e; color:#cdd6f4;
          padding:10px; border-radius:6px; overflow-x:auto; font-size:12px;
        }
        .msg-content strong { font-weight:600; }
        .msg-content a { color:var(--c); }
        .msg-content blockquote {
          border-left:3px solid var(--c); padding-left:10px; color:#555;
        }
        .msg-content h2, .msg-content h3 { font-size:14px; margin:6px 0 4px; }

        .cursor { animation:mwz-blink .8s step-end infinite; }
        @keyframes mwz-blink { 0%,100%{opacity:1} 50%{opacity:0} }

        /* Chips */
        .chips { display:flex; flex-wrap:wrap; gap:6px; padding:4px 0; }
        .chip {
          background:#fff; border:1.5px solid var(--c); color:var(--c);
          padding:4px 10px; border-radius:14px; font-size:12px;
          cursor:pointer; font-family:inherit; transition:background .15s, color .15s;
        }
        .chip:hover { background:var(--c); color:#fff; }

        /* Footer / input */
        .footer {
          border-top:1px solid #eee; padding:10px 12px;
          display:flex; gap:8px; align-items:center;
        }
        #input {
          flex:1; border:1.5px solid #e0e0e0; border-radius:10px;
          padding:8px 12px; font-size:13.5px; font-family:inherit;
          outline:none; transition:border-color .2s; color:#111; background:#fff;
        }
        #input:focus { border-color:var(--c); }
        #input:disabled { background:#f8f8f8; }

        #send, #ptt {
          width:36px; height:36px; border-radius:10px;
          border:none; cursor:pointer; flex-shrink:0;
          display:flex; align-items:center; justify-content:center; font-size:16px;
        }
        #send {
          background:var(--c); color:#fff; transition:opacity .2s;
        }
        #send:disabled { opacity:.4; cursor:default; }
        #send:hover:not(:disabled) { opacity:.88; }
        #ptt { background:#f0f0f0; transition:background .15s; touch-action:none; }
        #ptt.recording { background:#fee2e2; }
        #ptt:hover { background:#e8e8e8; }

        /* Powered-by footer */
        .powered {
          text-align:center; font-size:10px; color:#bbb;
          padding:4px 0 6px; letter-spacing:.3px;
        }
      </style>

      <div class="panel">
        <div class="header">
          <div class="header-dot"></div>
          <span class="header-name">${this.name}</span>
          <div class="header-actions">
            <button class="icon-btn" id="lang-toggle" title="Switch language">SW</button>
            <button class="icon-btn" id="clear">↺</button>
            <button class="icon-btn" id="close">✕</button>
          </div>
        </div>
        <div id="status"></div>
        <div id="msg-list"></div>
        <div class="footer">
          <button id="ptt">🎙</button>
          <input id="input" type="text" autocomplete="off">
          <button id="send" title="Send">↑</button>
        </div>
        <div class="powered">Powered by Mwongozo</div>
      </div>
    `;
  }
}
