/**
 * MwongozoWidget — main orchestrator.
 * Wires together Orb, Panel, ChatService, AudioService, DOMHighlighter,
 * PageContext, and AuthContext.
 */

import { OrbComponent }   from './orb.js';
import { PanelComponent } from './panel.js';
import { ChatService }    from './chat.js';
import { AudioService }   from './audio.js';
import { DOMHighlighter } from './highlighter.js';
import { getPageContext } from './context.js';
import { getUserContext } from './auth.js';
import { detectLang, t } from './i18n.js';

export class MwongozoWidget {
  constructor(config) {
    this.orgId     = config.orgId    || 'default';
    this.proxyUrl  = config.proxyUrl || 'http://localhost:8787';
    this.orgConfig = config.orgConfig || {};

    const theme = this.orgConfig.theme || config.theme || '#00843D';
    const name  = this.orgConfig.name  || config.name  || 'Msaada';
    const lang  = detectLang(this.orgConfig.language);

    this._lang = lang;

    this._orb = new OrbComponent({
      theme, name,
      position: config.position || 'bottom-right',
    });
    this._panel = new PanelComponent({
      theme, name,
      welcomeMessage:     this.orgConfig.welcomeMessage,
      suggestedQuestions: this.orgConfig.suggestedQuestions || [],
      language: lang,
    });
    this._chat  = new ChatService(this.proxyUrl, this.orgId);
    this._audio = new AudioService(this.proxyUrl, this.orgId);
    this._hl    = new DOMHighlighter(theme);

    this._guideQueue = [];
    this._guideTimer = null;
    this._userContext = null; // set during init
  }

  async init() {
    // Read auth context from host page
    this._userContext = getUserContext();

    const container = document.body;
    this._orb.mount(container);
    this._panel.mount(container);

    // Personalise welcome if we know the user's name
    if (this._userContext?.name && this.orgConfig.welcomeMessage) {
      // Already handled by org config; personalisation can be added by orgs
    }

    this._panel.loadHistory(this._chat.history);

    this._orb.onClick(() => this._panel.toggle());
    this._panel.onSend((text) => this._handleUserInput(text));
    this._panel.onClear(() => {
      this._chat.clearHistory();
      this._hl.clearAll();
    });
    this._panel.onLangChange((lang) => { this._lang = lang; });

    if (this._audio.canRecord) {
      this._panel.onPttStart(() => this._startRecording());
      this._panel.onPttEnd(()   => this._stopRecording());
    }

    // Expose globally for programmatic control
    window.mwongozo = this;
  }

  // --- Input handling ---

  async _handleUserInput(text) {
    const lang = this._lang;
    this._orb.setState('processing');
    this._panel.setStatus('statusThinking');
    this._panel.setInputEnabled(false);
    this._hl.clearAll();
    this._guideQueue = [];

    // Log user message
    this._logMessage('user', text);

    await this._chat.stream(text, getPageContext(), this._userContext, {
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
        this._logMessage('assistant', cleanText);
        try { await this._audio.speak(cleanText, lang); } catch (_) {}
      },

      onError: () => {
        this._panel.addMessage('assistant', t(lang, 'errorGeneric'));
        this._panel.setStatus('');
        this._panel.setInputEnabled(true);
        this._orb.setState('idle');
      },
    });
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
    } catch (_) {
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
    } catch (_) {
      this._panel.setStatus('statusError');
      this._orb.setState('idle');
    }
  }

  // --- Analytics ---

  _logMessage(role, text) {
    try {
      fetch(`${this.proxyUrl}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Org-Id': this.orgId },
        body: JSON.stringify({
          role, text,
          page:      location.href,
          lang:      this._lang,
          sessionId: this._sessionId(),
          userRole:  this._userContext?.role || null,
        }),
      }).catch(() => {});
    } catch (_) {}
  }

  _sessionId() {
    if (!this.__sid) this.__sid = `${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    return this.__sid;
  }
}
