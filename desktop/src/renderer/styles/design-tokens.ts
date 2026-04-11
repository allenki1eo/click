/**
 * Mwongozo Design System tokens — ported from Clicky's DesignSystem.swift.
 *
 * Dark theme, professional but warm. East African green as the accent.
 * DM Sans chosen because it renders well for both Latin and extended
 * characters used in Swahili.
 */
export const DS = {
  colors: {
    /** Page / window background */
    bg: '#0a0e17',
    /** Card / panel surface */
    surface: '#111827',
    /** Elevated surface (modals, dropdowns) */
    surface2: '#1f2937',
    /** Subtle dividers and borders */
    border: 'rgba(255,255,255,0.08)',
    /** Primary accent — East African green */
    accent: '#10b981',
    /** Secondary accent — used for info states */
    accentBlue: '#3b82f6',
    /** Primary text */
    text: '#f9fafb',
    /** Secondary / label text */
    textMuted: '#9ca3af',
    /** Overlay cursor pointer color */
    cursor: '#10b981',
    /** Error / destructive actions */
    danger: '#ef4444',
    /** Warning */
    warning: '#f59e0b',
    /** Success confirmation */
    success: '#10b981'
  },

  font: {
    /** UI text — works well with Swahili and English */
    ui: '"DM Sans", system-ui, sans-serif',
    /** Code / debug output */
    mono: '"JetBrains Mono", monospace'
  },

  radius: {
    sm: '6px',
    md: '10px',
    lg: '16px',
    pill: '999px'
  },

  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    xxl: '32px'
  },

  shadow: {
    /** Elevated panels / popovers */
    panel: '0 8px 32px rgba(0,0,0,0.6)',
    /** Overlay text bubble */
    bubble: '0 4px 16px rgba(0,0,0,0.8)'
  },

  /** Companion state → accent color mapping for the tray indicator dot */
  stateColors: {
    idle: '#9ca3af',
    listening: '#10b981',
    transcribing: '#3b82f6',
    processing: '#f59e0b',
    speaking: '#10b981',
    error: '#ef4444'
  } as Record<string, string>,

  /** Companion state → Swahili label */
  stateLabels_sw: {
    idle: 'Tayari',
    listening: 'Sikilizando...',
    transcribing: 'Inabadilisha sauti...',
    processing: 'Inafikiria...',
    speaking: 'Inasema...',
    error: 'Hitilafu'
  } as Record<string, string>,

  /** Companion state → English label */
  stateLabels_en: {
    idle: 'Ready',
    listening: 'Listening...',
    transcribing: 'Transcribing...',
    processing: 'Thinking...',
    speaking: 'Speaking...',
    error: 'Error'
  } as Record<string, string>
} as const
