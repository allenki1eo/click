/**
 * MwongozoWidget — main orchestrator.
 * Wires together: Orb, Panel, ChatService, AudioService, DOMHighlighter, PageContext.
 */

import { OrbComponent }    from './orb.js';
import { PanelComponent }  from './panel.js';
import { ChatService }     from './chat.js';
import { AudioService }    from './audio.js';
import { DOMHighlighter }  from './highlighter.js';
import { getPageContext }  from './context.js';

export class MwongozoWidget {
  constructor(config) {
    this.orgId    = config.orgId || 'default';
    this.proxyUrl = config.proxyUrl || 'http://localhost:8787';
    this.orgConfig = config.orgConfig || {};

    const theme   = this.orgConfig.theme || config.theme || '#00843D';
    const name    = this.orgConfig.name  || config.name  || 'Msaada';

    this._orb  = new OrbComponent({
      theme,
      name,
      position: config.position || 'bottom-right',
    });
    this._panel = new PanelComponent({
      theme,
      name,
      welcomeMessage:     this.orgConfig.welcomeMessage,
      suggestedQuestions: this.orgConfig.suggestedQuestions || [],
      language:           this.orgConfig.language || 'sw-en',
    });
    this._chat = new ChatService(this.proxyUrl, this.orgId);
    this._audio = new AudioService(this.proxyUrl, this.orgId);
    this._hl   = new DOMHighlighter(theme);

    this._guideQueue = [];
    this._guideTimer = null;
  }

  async init() {
    const container = document.body;

    // Mount UI components
    this._orb.mount(container);
    this._panel.mount(container);

    // Load existing history
    this._panel.loadHistory(this._chat.history);

    // Wire up orb
    this._orb.onClick(() => this._panel.toggle());

    // Wire up panel
    this._panel.onSend((text) => this._handleUserInput(text));
    this._panel.onClear(() => {
      this._chat.clearHistory();
      this._hl.clearAll();
    });

    // PTT
    if (this._audio.canRecord) {
      this._panel.onPttStart(() => this._startRecording());
      this._panel.onPttEnd(()   => this._stopRecording());
    }
  }

  // --- User input handling ---

  async _handleUserInput(text) {
    this._orb.setState('processing');
    this._panel.setStatus('Nafikiri...');
    this._panel.setInputEnabled(false);
    this._hl.clearAll();
    this._guideQueue = [];

    let firstGuideFired = false;

    await this._chat.stream(text, getPageContext(), {
      onChunk: (chunk, full) => {
        this._orb.setState('responding');
        this._panel.streamChunk(chunk, full);
        this._panel.setStatus('');
      },

      onGuide: (guide) => {
        // Queue guides and fire them with a small delay so UI is visible first
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

        // Speak the response
        try { await this._audio.speak(cleanText); } catch (_) {}
      },

      onError: (msg) => {
        this._panel.addMessage('assistant',
          `Samahani, kuna tatizo. / Sorry, there was an error: ${msg}`);
        this._panel.setStatus('');
        this._panel.setInputEnabled(true);
        this._orb.setState('idle');
      },
    });
  }

  _drainGuides() {
    this._guideTimer = null;
    // Stagger highlights so they don't all appear at once
    this._guideQueue.forEach((g, i) => {
      setTimeout(() => this._hl.guide(g), i * 400);
    });
    this._guideQueue = [];
  }

  // --- Voice recording ---

  async _startRecording() {
    try {
      this._orb.setState('listening');
      this._panel.setStatus('Sikiliza...');
      await this._audio.startRecording();
    } catch (err) {
      console.warn('[mwz] Mic access denied:', err.message);
      this._panel.setStatus('Ruhusa ya maikrofoni inahitajika');
      this._orb.setState('idle');
    }
  }

  async _stopRecording() {
    try {
      this._orb.setState('processing');
      this._panel.setStatus('Inabadilisha sauti...');
      const text = await this._audio.stopRecording();
      if (text?.trim()) {
        this._panel.addMessage('user', text);
        await this._handleUserInput(text);
      } else {
        this._panel.setStatus('Sauti haikueleweka. Jaribu tena.');
        this._orb.setState('idle');
      }
    } catch (err) {
      console.error('[mwz] Transcription error:', err.message);
      this._panel.setStatus('Hitilafu ya sauti. Jaribu tena.');
      this._orb.setState('idle');
    }
  }
}
