/**
 * Orb component — premium glassmorphism floating assistant orb.
 * Design: layered glass sphere · animated gradient ring · iris eyes · state auras
 */

const ORB_SIZE = 72;

export class OrbComponent {
  constructor({ theme, name, position }) {
    this.theme    = theme    || '#6366f1';
    this.name     = name     || 'Msaada';
    this.position = position || 'bottom-right';
    this.state    = 'idle';
    this._host    = null;
    this._shadow  = null;
    this._onClick = null;
    this._blinkTimer = null;
    this._eyeL = null;
    this._eyeR = null;
    this._ringRotation = 0;
    this._rafId = null;
  }

  mount(container) {
    this._host = document.createElement('div');
    this._host.id = 'mwz-orb-host';
    Object.assign(this._host.style, {
      position: 'fixed',
      ...this._posStyle(),
      zIndex: '2147483647',
      userSelect: 'none',
      WebkitUserSelect: 'none',
    });

    this._shadow = this._host.attachShadow({ mode: 'open' });
    this._shadow.innerHTML = this._template();
    container.appendChild(this._host);

    this._orbEl   = this._shadow.getElementById('orb');
    this._ringEl  = this._shadow.getElementById('ring');
    this._ring2El = this._shadow.getElementById('ring2');
    this._auraEl  = this._shadow.getElementById('aura');
    this._eyeL    = this._shadow.getElementById('pupil-l');
    this._eyeR    = this._shadow.getElementById('pupil-r');
    this._badge   = this._shadow.getElementById('badge');
    this._ripples = this._shadow.getElementById('ripples');
    this._smileEl = this._shadow.getElementById('smile');

    this._orbEl.addEventListener('click', () => this._onClick?.());
    this._orbEl.addEventListener('mouseenter', () => this._orbEl.classList.add('hover'));
    this._orbEl.addEventListener('mouseleave', () => this._orbEl.classList.remove('hover'));
    this._orbEl.addEventListener('mousedown',  () => this._orbEl.classList.add('press'));
    document.addEventListener('mouseup',       () => this._orbEl.classList.remove('press'));

    document.addEventListener('mousemove', e => this._trackEyes(e));
    this._scheduleBlink();
    this._animateRing();
  }

  onClick(cb)  { this._onClick = cb; }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    if (!this._orbEl) return;

    // Update orb class for CSS state
    this._orbEl.className = `orb ${state}`;

    // Badge
    const badge = this._badge;
    if (state === 'listening') {
      badge.textContent = '● REC';
      badge.style.display = 'block';
      badge.style.background = 'rgba(239,68,68,0.9)';
    } else if (state === 'responding') {
      badge.textContent = '♪';
      badge.style.display = 'block';
      badge.style.background = `rgba(${this._rgb()},0.9)`;
    } else {
      badge.style.display = 'none';
    }

    // Ripple waves (listening only)
    if (this._ripples) {
      this._ripples.style.display = state === 'listening' ? 'block' : 'none';
    }
  }

  setTheme(hex) {
    this.theme = hex;
    const styleEl = this._shadow.getElementById('theme-vars');
    if (styleEl) styleEl.textContent = this._themeVars();
    const auraEl = this._shadow.getElementById('aura');
    if (auraEl) auraEl.style.background = `radial-gradient(circle, rgba(${this._rgb()},0.35) 0%, transparent 70%)`;
  }

  destroy() {
    clearTimeout(this._blinkTimer);
    cancelAnimationFrame(this._rafId);
    this._host?.remove();
  }

  // ── Eye tracking ─────────────────────────────────────────────────────────

  _trackEyes(e) {
    if (!this._eyeL) return;
    const rect = this._host.getBoundingClientRect();
    const cx   = rect.left + rect.width  / 2;
    const cy   = rect.top  + rect.height / 2;
    const dx   = e.clientX - cx;
    const dy   = e.clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const MAX  = 5;
    const fac  = Math.min(dist / 90, 1);
    const px   = (dx / dist) * fac * MAX;
    const py   = (dy / dist) * fac * MAX;
    const t    = `translate(${px}px, ${py}px)`;
    this._eyeL.style.transform = t;
    this._eyeR.style.transform = t;
  }

  // ── Ring animation (rAF for smooth rotation) ─────────────────────────────

  _animateRing() {
    const speed = this.state === 'processing' ? 4
      : this.state === 'listening'  ? 2
      : this.state === 'responding' ? 1.5
      : 0.5;

    this._ringRotation = (this._ringRotation + speed) % 360;
    if (this._ringEl) {
      this._ringEl.style.transform  = `rotate(${this._ringRotation}deg)`;
      this._ring2El.style.transform = `rotate(${-this._ringRotation * 0.6}deg)`;
    }
    this._rafId = requestAnimationFrame(() => this._animateRing());
  }

  // ── Blink ─────────────────────────────────────────────────────────────────

  _scheduleBlink() {
    const delay = 2500 + Math.random() * 4500;
    this._blinkTimer = setTimeout(() => {
      this._shadow.querySelectorAll('.lid').forEach(l => l.classList.add('blink'));
      setTimeout(() => {
        this._shadow.querySelectorAll('.lid').forEach(l => l.classList.remove('blink'));
        this._scheduleBlink();
      }, 130);
    }, delay);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _posStyle() {
    switch (this.position) {
      case 'bottom-left': return { bottom: '24px', left: '24px' };
      case 'top-right':   return { top: '24px', right: '24px' };
      case 'top-left':    return { top: '24px', left: '24px' };
      default:            return { bottom: '24px', right: '24px' };
    }
  }

  _rgb() {
    const h = this.theme.replace('#', '');
    return `${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)}`;
  }

  _themeVars() {
    return `:host { --c: ${this.theme}; --rgb: ${this._rgb()}; }`;
  }

  _template() {
    const rgb = this._rgb();
    return `
      <style>
        ${this._themeVars()}

        :host { display: block; }

        /* ── Wrapper ─────────────────────────────────────────────────── */
        .wrapper {
          width: ${ORB_SIZE + 32}px;
          height: ${ORB_SIZE + 32}px;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }

        /* ── Aura glow ───────────────────────────────────────────────── */
        #aura {
          position: absolute;
          width: ${ORB_SIZE + 48}px;
          height: ${ORB_SIZE + 48}px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(${rgb},0.28) 0%, transparent 70%);
          animation: aura-pulse 3s ease-in-out infinite;
          pointer-events: none;
        }
        .orb.listening  ~ #aura,
        .orb.listening + * + * + #aura {
          animation: aura-pulse 1.2s ease-in-out infinite;
        }

        /* ── Gradient ring (outer) ───────────────────────────────────── */
        .ring-wrap {
          position: absolute;
          width: ${ORB_SIZE + 18}px;
          height: ${ORB_SIZE + 18}px;
          border-radius: 50%;
          pointer-events: none;
        }
        .ring-segment {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 2px solid transparent;
          background:
            transparent padding-box,
            conic-gradient(
              from 0deg,
              transparent 0%,
              var(--c) 25%,
              rgba(${rgb},0.4) 45%,
              transparent 55%
            ) border-box;
        }
        #ring  { opacity: 0.85; }
        #ring2 {
          border-color: transparent;
          background:
            transparent padding-box,
            conic-gradient(
              from 0deg,
              transparent 50%,
              rgba(${rgb},0.3) 75%,
              transparent 85%
            ) border-box;
          opacity: 0.5;
        }

        /* ── Ripple waves (listening) ────────────────────────────────── */
        #ripples { display: none; pointer-events: none; }
        .ripple {
          position: absolute;
          border-radius: 50%;
          border: 1.5px solid rgba(${rgb},0.5);
          animation: ripple-out 2s ease-out infinite;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
        }
        .ripple:nth-child(2) { animation-delay: 0.65s; }
        .ripple:nth-child(3) { animation-delay: 1.3s; }

        /* ── Orb body ────────────────────────────────────────────────── */
        .orb {
          width: ${ORB_SIZE}px;
          height: ${ORB_SIZE}px;
          border-radius: 50%;
          cursor: pointer;
          position: relative;
          z-index: 1;

          /* Layered glass sphere */
          background:
            radial-gradient(circle at 34% 28%, rgba(255,255,255,0.42) 0%, transparent 38%),
            radial-gradient(circle at 72% 78%, rgba(${rgb},0.18) 0%, transparent 35%),
            radial-gradient(circle at 50% 50%,
              rgba(${rgb},0.92) 0%,
              rgba(${rgb},0.78) 45%,
              rgba(${rgb},0.55) 100%);

          box-shadow:
            0 0 0 1.5px rgba(255,255,255,0.16),
            0 4px 24px rgba(${rgb},0.55),
            0 12px 48px rgba(${rgb},0.22),
            0 24px 64px rgba(0,0,0,0.3),
            inset 0 1.5px 0 rgba(255,255,255,0.4),
            inset 0 -2px 6px rgba(0,0,0,0.25);

          transition:
            transform 0.15s cubic-bezier(.34,1.56,.64,1),
            box-shadow 0.4s ease;
        }

        /* State shadows */
        .orb.listening {
          box-shadow:
            0 0 0 1.5px rgba(255,255,255,0.22),
            0 0 28px rgba(${rgb},0.85),
            0 0 56px rgba(${rgb},0.4),
            0 12px 40px rgba(0,0,0,0.35),
            inset 0 1.5px 0 rgba(255,255,255,0.45),
            inset 0 -2px 6px rgba(0,0,0,0.2);
        }
        .orb.processing {
          box-shadow:
            0 0 0 1.5px rgba(255,255,255,0.1),
            0 0 18px rgba(${rgb},0.5),
            0 12px 40px rgba(0,0,0,0.4),
            inset 0 1.5px 0 rgba(255,255,255,0.3),
            inset 0 -2px 6px rgba(0,0,0,0.3);
          filter: brightness(0.88) saturate(0.8);
        }
        .orb.responding {
          box-shadow:
            0 0 0 1.5px rgba(255,255,255,0.28),
            0 0 36px rgba(${rgb},0.9),
            0 0 72px rgba(${rgb},0.45),
            0 16px 48px rgba(0,0,0,0.3),
            inset 0 1.5px 0 rgba(255,255,255,0.5),
            inset 0 -2px 6px rgba(0,0,0,0.15);
          filter: brightness(1.08);
        }

        .orb.hover { transform: scale(1.08) translateY(-2px); }
        .orb.press { transform: scale(0.88); transition-duration: 0.08s; }

        /* Animated breathing for idle */
        .orb.idle { animation: orb-breathe 4s ease-in-out infinite; }
        .orb.listening { animation: orb-breathe-fast 1.1s ease-in-out infinite; }
        .orb.responding { animation: orb-breathe-mid 2s ease-in-out infinite; }

        /* Glass gloss highlight */
        .gloss {
          position: absolute;
          top: 9px; left: 13px;
          width: 22px; height: 12px;
          border-radius: 50%;
          background: rgba(255,255,255,0.36);
          transform: rotate(-30deg);
          pointer-events: none;
          filter: blur(1px);
        }
        .gloss-small {
          position: absolute;
          top: 18px; left: 22px;
          width: 8px; height: 5px;
          border-radius: 50%;
          background: rgba(255,255,255,0.22);
          pointer-events: none;
        }

        /* Rim sheen */
        .rim {
          position: absolute;
          bottom: 8px; left: 50%;
          transform: translateX(-50%);
          width: 40px; height: 8px;
          border-radius: 50%;
          background: rgba(${rgb},0.3);
          filter: blur(3px);
          pointer-events: none;
        }

        /* ── Eyes ────────────────────────────────────────────────────── */
        .eyes {
          position: absolute;
          top: 38%; left: 50%;
          transform: translate(-50%, -50%);
          display: flex; gap: 10px;
        }

        .eye {
          width: 15px; height: 18px;
          border-radius: 50%;
          background: radial-gradient(circle at 40% 35%,
            rgba(255,255,255,0.98),
            rgba(240,248,255,0.92) 60%,
            rgba(220,235,255,0.85));
          box-shadow:
            inset 0 2px 4px rgba(0,0,0,0.14),
            0 1px 2px rgba(255,255,255,0.4);
          position: relative;
          overflow: hidden;
          flex-shrink: 0;
        }

        /* Eyelid (blink) */
        .lid {
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 0;
          background: radial-gradient(
            circle at 50% 0%,
            rgba(${rgb},0.9),
            rgba(${rgb},0.7)
          );
          transition: height 0.08s ease;
          border-radius: 0 0 50% 50%;
        }
        .lid.blink { height: 100%; }

        /* Processing squint */
        .orb.processing .eye { height: 8px; transition: height 0.2s ease; }

        .pupil {
          position: absolute;
          width: 8px; height: 8px;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 30%, #2d2d3a, #0a0a14);
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          transition: transform 0.05s ease;
          box-shadow: 0 1px 3px rgba(0,0,0,0.4);
        }
        /* Iris tint */
        .pupil::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: rgba(${rgb},0.15);
        }
        /* Specular highlight */
        .pupil::after {
          content: '';
          position: absolute;
          width: 3px; height: 3px;
          top: 1.5px; left: 2px;
          border-radius: 50%;
          background: rgba(255,255,255,0.95);
        }

        /* ── Smile ───────────────────────────────────────────────────── */
        #smile {
          position: absolute;
          bottom: 13px; left: 50%;
          transform: translateX(-50%);
          width: 26px; height: 10px;
          border-bottom: 2px solid rgba(255,255,255,0.65);
          border-radius: 0 0 50% 50%;
          transition: width 0.3s ease, border-color 0.3s;
          pointer-events: none;
        }
        .orb.responding #smile { width: 34px; border-color: rgba(255,255,255,0.9); }
        .orb.listening  #smile { width: 20px; border-color: rgba(255,255,255,0.5); }
        .orb.processing #smile { width: 18px; border-radius: 50% 50% 0 0;
          border-bottom: none; border-top: 2px solid rgba(255,255,255,0.35); }

        /* ── State badge ─────────────────────────────────────────────── */
        #badge {
          display: none;
          position: absolute;
          top: -8px; right: -10px;
          color: #fff;
          font-size: 9px;
          font-weight: 700;
          font-family: system-ui, sans-serif;
          letter-spacing: 0.05em;
          padding: 3px 6px;
          border-radius: 8px;
          white-space: nowrap;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          border: 1px solid rgba(255,255,255,0.2);
        }

        /* ── Hover label ─────────────────────────────────────────────── */
        .orb-label {
          position: absolute;
          bottom: calc(100% + 10px);
          left: 50%; transform: translateX(-50%);
          background: rgba(15,15,20,0.92);
          backdrop-filter: blur(8px);
          color: rgba(255,255,255,0.9);
          font-size: 11px;
          font-family: system-ui, sans-serif;
          font-weight: 500;
          padding: 4px 10px;
          border-radius: 6px;
          white-space: nowrap;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.2s;
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        }
        .orb:hover .orb-label { opacity: 1; }
        .orb-label::after {
          content: '';
          position: absolute;
          top: 100%; left: 50%;
          transform: translateX(-50%);
          border: 4px solid transparent;
          border-top-color: rgba(15,15,20,0.92);
        }

        /* ── Keyframes ───────────────────────────────────────────────── */
        @keyframes aura-pulse {
          0%,100% { opacity: 0.5; transform: scale(1); }
          50%      { opacity: 1;   transform: scale(1.12); }
        }
        @keyframes orb-breathe {
          0%,100% { transform: scale(1); }
          50%      { transform: scale(1.03) translateY(-1px); }
        }
        @keyframes orb-breathe-fast {
          0%,100% { transform: scale(1); }
          50%      { transform: scale(1.06) translateY(-2px); }
        }
        @keyframes orb-breathe-mid {
          0%,100% { transform: scale(1); }
          50%      { transform: scale(1.04) translateY(-1px); }
        }
        @keyframes ripple-out {
          0%   { width: ${ORB_SIZE}px; height: ${ORB_SIZE}px; opacity: 0.6; }
          100% { width: ${ORB_SIZE + 60}px; height: ${ORB_SIZE + 60}px; opacity: 0; }
        }
      </style>

      <div class="wrapper">
        <!-- Aura glow -->
        <div id="aura"></div>

        <!-- Animated gradient ring -->
        <div class="ring-wrap" id="ring-wrap">
          <div class="ring-segment" id="ring"></div>
          <div class="ring-segment" id="ring2"></div>
        </div>

        <!-- Ripple waves (listening) -->
        <div id="ripples">
          <div class="ripple" style="width:${ORB_SIZE}px;height:${ORB_SIZE}px"></div>
          <div class="ripple" style="width:${ORB_SIZE}px;height:${ORB_SIZE}px"></div>
          <div class="ripple" style="width:${ORB_SIZE}px;height:${ORB_SIZE}px"></div>
        </div>

        <!-- Orb body -->
        <div class="orb idle" id="orb" role="button" tabindex="0" aria-label="${this.name}">
          <div class="gloss"></div>
          <div class="gloss-small"></div>
          <div class="rim"></div>

          <div class="eyes">
            <div class="eye">
              <div class="lid"></div>
              <div class="pupil" id="pupil-l"></div>
            </div>
            <div class="eye">
              <div class="lid"></div>
              <div class="pupil" id="pupil-r"></div>
            </div>
          </div>

          <div id="smile"></div>
          <div id="badge"></div>
          <div class="orb-label">${this.name}</div>
        </div>
      </div>
    `;
  }
}
