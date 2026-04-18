/**
 * Audio service — TTS playback and voice transcription.
 * TTS: ElevenLabs via proxy (fallback: Web Speech API)
 * STT: AssemblyAI via proxy (fallback: Web Speech API)
 */

export class AudioService {
  constructor(proxyUrl, orgId) {
    this.proxyUrl = proxyUrl.replace(/\/$/, '');
    this.orgId = orgId;
    this._mediaRecorder = null;
    this._chunks = [];
    this._audioCtx = null;
  }

  // --- TTS ---

  async speak(text) {
    // Strip markdown and GUIDE tags
    const clean = text
      .replace(/\[GUIDE:[^\]]+\]/g, '')
      .replace(/[*_`#>]/g, '')
      .trim();
    if (!clean) return;

    try {
      const resp = await fetch(`${this.proxyUrl}/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Org-Id': this.orgId,
        },
        body: JSON.stringify({ text: clean }),
      });

      if (!resp.ok) throw new Error(`TTS ${resp.status}`);

      const arrayBuf = await resp.arrayBuffer();
      await this._playAudioBuffer(arrayBuf);
    } catch (err) {
      console.warn('[mwz tts] ElevenLabs failed, using browser TTS:', err.message);
      this._webSpeech(clean);
    }
  }

  async _playAudioBuffer(arrayBuf) {
    if (!this._audioCtx) {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const decoded = await this._audioCtx.decodeAudioData(arrayBuf);
    const source = this._audioCtx.createBufferSource();
    source.buffer = decoded;
    source.connect(this._audioCtx.destination);
    return new Promise(resolve => {
      source.onended = resolve;
      source.start(0);
    });
  }

  _webSpeech(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'sw-TZ';
    window.speechSynthesis.speak(utt);
  }

  stop() {
    window.speechSynthesis?.cancel();
    this._audioCtx?.suspend();
  }

  // --- STT ---

  get canRecord() {
    return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  }

  async startRecording() {
    if (!this.canRecord) throw new Error('MediaRecorder not supported');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this._chunks = [];
    this._mediaRecorder = new MediaRecorder(stream, { mimeType: this._bestMime() });
    this._mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) this._chunks.push(e.data);
    };
    this._mediaRecorder.start(100);
  }

  async stopRecording() {
    if (!this._mediaRecorder) return '';
    return new Promise((resolve, reject) => {
      this._mediaRecorder.onstop = async () => {
        const blob = new Blob(this._chunks, { type: this._mediaRecorder.mimeType });
        // Stop all tracks
        this._mediaRecorder.stream.getTracks().forEach(t => t.stop());
        this._mediaRecorder = null;

        try {
          const text = await this._transcribe(blob);
          resolve(text);
        } catch (err) {
          reject(err);
        }
      };
      this._mediaRecorder.stop();
    });
  }

  async _transcribe(blob) {
    const arrayBuf = await blob.arrayBuffer();
    const resp = await fetch(`${this.proxyUrl}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Org-Id': this.orgId,
      },
      body: arrayBuf,
    });
    if (!resp.ok) throw new Error(`Transcription ${resp.status}`);
    const { text } = await resp.json();
    return text || '';
  }

  _bestMime() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  }
}
