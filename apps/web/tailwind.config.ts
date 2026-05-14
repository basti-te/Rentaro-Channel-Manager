import type { Config } from 'tailwindcss';

export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        canvas:        'rgb(var(--canvas) / <alpha-value>)',
        surface:       'rgb(var(--surface) / <alpha-value>)',
        sunken:        'rgb(var(--sunken) / <alpha-value>)',
        line:          'rgb(var(--line) / <alpha-value>)',
        'line-strong': 'rgb(var(--line-strong) / <alpha-value>)',

        ink:       'rgb(var(--ink) / <alpha-value>)',
        'ink-soft':'rgb(var(--ink-soft) / <alpha-value>)',
        muted:     'rgb(var(--muted) / <alpha-value>)',
        whisper:   'rgb(var(--whisper) / <alpha-value>)',

        brand:        'rgb(var(--brand) / <alpha-value>)',
        'brand-deep': 'rgb(var(--brand-deep) / <alpha-value>)',
        'brand-soft': 'rgb(var(--brand-soft) / <alpha-value>)',
        'brand-tint': 'rgb(var(--brand-tint) / <alpha-value>)',

        accent:       'rgb(var(--accent) / <alpha-value>)',
        'accent-soft':'rgb(var(--accent-soft) / <alpha-value>)',

        positive:       'rgb(var(--positive) / <alpha-value>)',
        'positive-soft':'rgb(var(--positive-soft) / <alpha-value>)',
        warning:        'rgb(var(--warning) / <alpha-value>)',
        'warning-soft': 'rgb(var(--warning-soft) / <alpha-value>)',
        danger:         'rgb(var(--danger) / <alpha-value>)',
        'danger-soft':  'rgb(var(--danger-soft) / <alpha-value>)',
      },
      fontFamily: {
        display: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
        sans:    ['Manrope', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Editorial display sizes
        'display-1': ['clamp(2.25rem, 4vw, 3.5rem)', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        'display-2': ['clamp(1.875rem, 3vw, 2.5rem)', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
        '2xl': 'var(--r-2xl)',
      },
      transitionTimingFunction: {
        'out-spring': 'cubic-bezier(0.34, 1.34, 0.6, 1)',
        'out-snap':   'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 360ms cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer:   'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
