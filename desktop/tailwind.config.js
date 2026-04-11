/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/**/*.{html,ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0a0e17',
        surface: '#111827',
        surface2: '#1f2937',
        accent: '#10b981',
        'accent-blue': '#3b82f6',
        muted: '#9ca3af',
        danger: '#ef4444'
      },
      fontFamily: {
        ui: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace']
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '16px',
        pill: '999px'
      },
      animation: {
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-gentle': 'bounce 1s ease-in-out infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out'
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        }
      }
    }
  },
  plugins: []
}
