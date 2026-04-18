/**
 * Orb component — animated floating character using Shadow DOM.
 * Eye-tracking, state-based animations, click-to-toggle panel.
 */

const ORB_SIZE = 66;

export class OrbComponent {
  constructor({ theme, name, position }) {
    this.theme = theme || '#00843D';
    this.name = name || 'Msaada';
    this.position = position || 'bottom-right';
    this.state = 'idle';
    this._host = null;
    this._shadow = null;
    this._onClick = null;
    this._blinkTimer = null;
    this._eyeL = null;
    this._eyeR = null;
  }

  mount(container) {
    this._host = document.createElement('div');
    this._host.id = 'mwz-orb-host';
    Object.assign(this._host.style, {
      position: 'fixed',
      ...this._positionStyle(),
      zIndex: '2147483647',
      userSelect: 'none',
      WebkitUserSelect: 'none',
    });

    this._shadow = this._host.attachShadow({ mode: 'open' });
    this._shadow.innerHTML = this._template();
    container.appendChild(this._host);

    this._orb = this._shadow.getElementById('orb');
    this._eyeL = this._shadow.getElementById('pupil-l');
    this._eyeR = this._shadow.getElementById('pupil-r');
    this._badge = this._shadow.getElementById('badge');
    this._ring = this._shadow.getElementById('ring');

    this._orb.addEventListener('click', () => this._onClick?.());
    this._orb.addEventListener('mouseenter', () => this._orb.classList.add('hover'));
    this._orb.addEventListener('mouseleave', () => this._orb.classList.remove('hover'));
    this._orb.addEventListener('mousedown', () => this._orb.classList.add('press'));
    this._orb.addEventListener('mouseup', () => this._orb.classList.remove('press'));

    // Eye tracking
    document.addEventListener('mousemove', (e) => this._trackEyes(e));

    // Random blink
    this._scheduleBlink();
  }

  onClick(cb) { this._onClick = cb; }

  setState(state) {
    this.state = state;
    const orb = this._orb;
    if (!orb) return;
    orb.className = `orb ${state}`;
    const badge = this._badge;
    if (state === 'listening') {
      badge.textContent = '● REC';
      badge.style.display = 'block';
    } else if (state === 'responding') {
      badge.textContent = '♪';
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  }

  setTheme(hex) {
    this.theme = hex;
    const style = this._shadow.getElementById('theme-vars');
    if (style) style.textContent = this._themeVars();
  }

  _trackEyes(e) {
    if (!this._eyeL) return;
    const rect = this._host.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const maxOffset = 4.5;
    const factor = Math.min(dist / 80, 1);
    const px = (dx / dist) * factor * maxOffset;
    const py = (dy / dist) * factor * maxOffset;
    this._eyeL.style.transform = `translate(${px}px, ${py}px)`;
    this._eyeR.style.transform = `translate(${px}px, ${py}px)`;
  }

  _scheduleBlink() {
    const delay = 3000 + Math.random() * 4000;
    this._blinkTimer = setTimeout(() => {
      const lids = this._shadow.querySelectorAll('.lid');
      lids.forEach(l => l.classList.add('blink'));
      setTimeout(() => lids.forEach(l => l.classList.remove('blink')), 150);
      this._scheduleBlink();
    }, delay);
  }

  _positionStyle() {
    switch (this.position) {
      case 'bottom-left':  return { bottom: '24px', left: '24px' };
      case 'top-right':    return { top: '24px', right: '24px' };
      case 'top-left':     return { top: '24px', left: '24px' };
      default:             return { bottom: '24px', right: '24px' };
    }
  }

  _themeVars() {
    const { r, g, b } = hexToRgb(this.theme);
    return `
      :host { --c: ${this.theme}; --cr: ${r}; --cg: ${g}; --cb: ${b}; }
    `;
  }

  _template() {
    const pos = this._positionStyle();
    return `
      <style>
        ${this._themeVars()}
        :host { display: block; }

        .orb {
          width: ${ORB_SIZE}px;
          height: ${ORB_SIZE}px;
          border-radius: 50%;
          cursor: pointer;
          position: relative;
          background: radial-gradient(circle at 35% 35%,
            color-mix(in srgb, var(--c) 60%, white),
            var(--c) 60%,
            color-mix(in srgb, var(--c) 80%, black));
          box-shadow: 0 4px 20px rgba(var(--cr), var(--cg), var(--cb), 0.4),
                      0 2px 8px rgba(0,0,0,0.3);
          transition: transform 0.1s ease, box-shadow 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          gap: 6px;
          overflow: visible;
        }

        .orb.hover { transform: scale(1.07); }
        .orb.press { transform: scale(0.86); }

        /* State glow */
        .orb.idle      { box-shadow: 0 4px 16px rgba(var(--cr),var(--cg),var(--cb),0.35); }
        .orb.listening { box-shadow: 0 0 0 4px rgba(var(--cr),var(--cg),var(--cb),0.5),
                                     0 0 20px rgba(var(--cr),var(--cg),var(--cb),0.6);
                         animation: mwz-pulse 1s ease-in-out infinite; }
        .orb.processing { animation: mwz-spin-ring 1s linear infinite; }
        .orb.responding { box-shadow: 0 0 24px rgba(var(--cr),var(--cg),var(--cb),0.55); }

        @keyframes mwz-pulse {
          0%,100% { box-shadow: 0 0 0 4px rgba(var(--cr),var(--cg),var(--cb),0.5); }
          50%     { box-shadow: 0 0 0 10px rgba(var(--cr),var(--cg),var(--cb),0.2); }
        }
        @keyframes mwz-spin-ring {
          from { filter: hue-rotate(0deg); }
          to   { filter: hue-rotate(360deg); }
        }

        /* Eyes */
        .eyes { display: flex; gap: 10px; margin-top: 4px; }
        .eye {
          width: 14px; height: 14px;
          background: #fff;
          border-radius: 50%;
          position: relative;
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
        }
        .lid {
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 0;
          background: color-mix(in srgb, var(--c) 80%, black);
          transition: height 0.08s ease;
          border-radius: 0 0 50% 50%;
        }
        .lid.blink { height: 100%; }
        .pupil {
          width: 7px; height: 7px;
          background: #1a1a2e;
          border-radius: 50%;
          transition: transform 0.05s ease;
          flex-shrink: 0;
        }

        /* Smile */
        .smile {
          width: 22px; height: 10px;
          border: 2.5px solid rgba(255,255,255,0.85);
          border-top: none;
          border-radius: 0 0 22px 22px;
          margin-top: -2px;
          transition: width 0.3s ease;
        }
        .orb.responding .smile { width: 30px; }
        .orb.listening .smile  { width: 16px; }
        .orb.processing .smile { border-color: rgba(255,255,255,0.5); }

        /* State badge */
        #badge {
          display: none;
          position: absolute;
          top: -6px; right: -6px;
          background: #fff;
          color: var(--c);
          font-size: 9px;
          font-weight: 700;
          font-family: system-ui, sans-serif;
          padding: 2px 5px;
          border-radius: 8px;
          white-space: nowrap;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2);
        }

        /* Gloss */
        .gloss {
          position: absolute;
          top: 8px; left: 12px;
          width: 18px; height: 10px;
          background: rgba(255,255,255,0.3);
          border-radius: 50%;
          transform: rotate(-30deg);
          pointer-events: none;
        }

        /* Tooltip on hover showing name */
        .orb-label {
          position: absolute;
          bottom: calc(100% + 8px);
          left: 50%; transform: translateX(-50%);
          background: #1a1a1a;
          color: #fff;
          font-size: 11px;
          font-family: system-ui, sans-serif;
          padding: 3px 8px;
          border-radius: 4px;
          white-space: nowrap;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.2s;
        }
        .orb:hover .orb-label { opacity: 1; }
      </style>

      <div class="orb idle" id="orb" role="button" aria-label="${this.name}" tabindex="0">
        <div class="gloss"></div>
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
        <div class="smile"></div>
        <div id="badge"></div>
        <div class="orb-label">${this.name}</div>
      </div>
    `;
  }

  destroy() {
    clearTimeout(this._blinkTimer);
    this._host?.remove();
  }
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}
