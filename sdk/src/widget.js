/**
 * MwongozoWidget — main orchestrator.
 * Wires together Orb, Panel, ChatService, AudioService, DOMHighlighter, PageContext.
 */

import { OrbComponent }   from './orb.js';
import { PanelComponent } from './panel.js';
import { ChatService }    from './chat.js';
import { AudioService }   from './audio.js';
import { DOMHighlighter } from './highlighter.js';
import { getPageContext } from './context.js';
import { detectLang, t } from './i18n.js';

export class MwongozoWidget {
  constructor(config) {
    this.orgId    = config.orgId    || 'default';
    this.proxyUrl = config.proxyUrl || 'http://localhost:8787';
    this.orgConfig = config.orgConfig || {};

    const theme = this.orgConfig.theme || config.theme || '#00843D';
    const name  = this.orgConfig.name  || config.name  || 'Msaada';
    const lang  = detectLang(this.orgConfig.language);

    this._lang = lang;

    this._orb = new OrbComponent({
      theme,
      name,
      position: config.position || 'bottom-right',
    });
    this._panel = new PanelComponent({
      theme,
      name,
      welcomeMessage:      this.orgConfig.welcomeMessage,
      suggestedQuestions:  this.orgConfig.suggestedQuestions || [],
      language:            lang,
    });
    this._chat  = new ChatService(this.proxyUrl, this.orgId);
    this._audio = new AudioService(this.proxyUrl, this.orgId);
    this._hl    = new DOMHighlighter(theme);

    this._guideQueue = [];
    this._guideTimer = null;
  }

  async init() {
    const container = document.body;
    this._orb.mount(container);
    this._panel.mount(container);

    // Restore history
    this._panel.loadHistory(this._chat.history);

    // Orb click → toggle panel
    this._orb.onClick(() => this._panel.toggle());

    // Panel events
    this._panel.onSend((text) => this._handleUserInput(text));
    this._panel.onClear(() => {
      this._chat.clearHistory();
      this._hl.clearAll();
    });
    this._panel.onLangChange((lang) => {
      this._lang = lang;
    });

    // PTT
    if (this._audio.canRecord) {
      this._panel.onPttStart(() => this._startRecording());
      this._panel.onPttEnd(()   => this._stopRecording());
    }
  }

  // --- Input handling ---

  async _handleUserInput(text) {
    const lang = this._lang;
    this._orb.setState('processing');
    this._panel.setStatus('statusThinking');
    this._panel.setInputEnabled(false);
    this._hl.clearAll();
    this._guideQueue = [];

    await this._chat.stream(text, getPageContext(), {
      onChunk: (chunk, full) => {
        this._orb.setState('responding');
        this._panel.streamChunk(chunk, full);
        this._panel.setStatus('');
      },

      onGuide: (guide) => {
        this._guideQueue.push(guide);
        if (!this._guideTimer) {
          this._guideTimer = setTimeout(() => this._drainGuides(), 800);
        }
      },

      onDone: async (cleanText, rawText) => {
        this._panel.addMessage('assistant', rawText);
        this._panel.setStatus('');
        this._panel.setInputEnabled(true);
        this._orb.setState('idle');
        this._guideTimer = null;
        this._drainGuides();

        // Log to proxy analytics
        this._logMessage('assistant', cleanText);

        try { await this._audio.speak(cleanText, lang); } catch (_) {}
      },

      onError: (msg) => {
        this._panel.addMessage('assistant', t(lang, 'errorGeneric'));
        this._panel.setStatus('');
        this._panel.setInputEnabled(true);
        this._orb.setState('idle');
      },
    });

    // Log user message
    this._logMessage('user', text);
  }

  _drainGuides() {
    this._guideTimer = null;
    this._guideQueue.forEach((g, i) => setTimeout(() => this._hl.guide(g), i * 400));
    this._guideQueue = [];
  }

  // --- Voice ---

  async _startRecording() {
    try {
      this._orb.setState('listening');
      this._panel.setStatus('statusListening');
      await this._audio.startRecording();
    } catch (err) {
      this._panel.setStatus('statusMicDenied');
      this._orb.setState('idle');
    }
  }

  async _stopRecording() {
    try {
      this._orb.setState('processing');
      this._panel.setStatus('statusTranscribing');
      const text = await this._audio.stopRecording();
      if (text?.trim()) {
        this._panel.addMessage('user', text);
        await this._handleUserInput(text);
      } else {
        this._panel.setStatus('statusNoSpeech');
        this._orb.setState('idle');
      }
    } catch (err) {
      this._panel.setStatus('statusError');
      this._orb.setState('idle');
    }
  }

  // --- Analytics ---

  _logMessage(role, text) {
    try {
      fetch(`${this.proxyUrl}/log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Org-Id': this.orgId,
        },
        body: JSON.stringify({
          role,
          text,
          page: location.href,
          lang: this._lang,
          sessionId: this._sessionId(),
        }),
      }).catch(() => {}); // fire-and-forget, never block UI
    } catch (_) {}
  }

  _sessionId() {
    if (!this.__sid) {
      this.__sid = `${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    }
    return this.__sid;
  }
}
