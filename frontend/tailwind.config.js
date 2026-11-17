/** @type {import('tailwindcss').Config} */
import plugin from 'tailwindcss/plugin'

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Named layers. `sticky`: a sticky column above the cells it scrolls over. `viewer`:
      // fullscreen file viewer and top-level popovers. `overlay`: floating card over the page,
      // dialogs, and viewer (the incoming call), still under viewer menus and toasts.
      zIndex: {
        sticky: '1',
        viewer: '60',
        overlay: '65',
        // Menus opened from inside the file viewer (`z-viewer`).
        'viewer-menu': '70',
      },
      fontFamily: {
        sans: ['Onest', 'system-ui', 'sans-serif'],
        // Codes only: CUI, IBAN, document numbers, keys (DESIGN.md). Not every number.
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        title: '-0.02em',
      },
      spacing: {
        // Page margins of the airy density: 28 / 20 (20 on a phone).
        'page-x': 'var(--page-x)',
        'page-y': 'var(--page-y)',
      },
      fontSize: {
        // The style's sizes outside Tailwind's scale: table row 13.5, button 13 (row actions).
        row: ['13.5px', '1.4'],
        btn: ['13px', '1.25'],
        // Decimals of an amount at 0.73 of the figure (Mercury), so the whole part reads first.
        fraction: '0.73em',
        // The one figure of Home.
        figure: ['2rem', '1.15'],
      },
      height: {
        row: 'var(--row-h)',
        'control-sm': 'var(--control-sm)',
        'control-md': 'var(--control-md)',
        'control-lg': 'var(--control-lg)',
      },
      minHeight: {
        'control-md': 'var(--control-md)',
        row: 'var(--row-h)',
      },
      width: {
        'control-sm': 'var(--control-sm)',
        'control-md': 'var(--control-md)',
        'control-lg': 'var(--control-lg)',
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        'border-strong': 'hsl(var(--border-strong))',
        'text-3': 'hsl(var(--text-3))',
        glow: {
          DEFAULT: 'hsl(var(--glow))',
          ink: 'hsl(var(--glow-ink))',
        },
        brand: 'hsl(var(--brand))',
        logo: {
          fill: 'hsl(var(--logo-fill))',
          line: 'hsl(var(--logo-line))',
        },
        zebra: 'hsl(var(--zebra))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
          text: 'hsl(var(--destructive-text))',
        },
        bubble: {
          own: 'hsl(var(--bubble-own))',
          other: 'hsl(var(--bubble-other))',
        },
        'tick-seen': 'hsl(var(--tick-seen))',
        tag: {
          1: 'hsl(var(--tag-1))',
          '1-surface': 'hsl(var(--tag-1-surface))',
          2: 'hsl(var(--tag-2))',
          '2-surface': 'hsl(var(--tag-2-surface))',
          3: 'hsl(var(--tag-3))',
          '3-surface': 'hsl(var(--tag-3-surface))',
          4: 'hsl(var(--tag-4))',
          '4-surface': 'hsl(var(--tag-4-surface))',
          5: 'hsl(var(--tag-5))',
          '5-surface': 'hsl(var(--tag-5-surface))',
          6: 'hsl(var(--tag-6))',
          '6-surface': 'hsl(var(--tag-6-surface))',
          7: 'hsl(var(--tag-7))',
          '7-surface': 'hsl(var(--tag-7-surface))',
          8: 'hsl(var(--tag-8))',
          '8-surface': 'hsl(var(--tag-8-surface))',
        },
        surface: {
          raised: 'hsl(var(--surface-raised))',
          overlay: 'hsl(var(--surface-overlay))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
          text: 'hsl(var(--success-text))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
          text: 'hsl(var(--warning-text))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
      },
      // The style's three radii: small 4, control 6, panel 10.
      borderRadius: {
        lg: '10px',
        md: '6px',
        sm: '4px',
      },
      transitionTimingFunction: {
        'out-strong': 'cubic-bezier(0.22, 1, 0.36, 1)',
        'in-out-strong': 'cubic-bezier(0.77, 0, 0.175, 1)',
        drawer: 'var(--ease-drawer)',
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        standard: 'var(--duration-standard)',
        screen: 'var(--duration-screen)',
      },
      boxShadow: {
        glow: '0 0 0 1px hsl(var(--glow) / 0.45), 0 0 24px -4px hsl(var(--glow) / 0.45)',
        float: 'var(--shadow-l)',
      },
    },
  },
  plugins: [
    plugin(({ addUtilities, matchUtilities, theme }) => {
      addUtilities({
        '@keyframes enter': {
          from: {
            opacity: 'var(--tw-enter-opacity, 1)',
            transform:
              'translate3d(0, var(--tw-enter-translate-y, 0), 0) scale3d(var(--tw-enter-scale, 1), var(--tw-enter-scale, 1), var(--tw-enter-scale, 1))',
          },
        },
        '@keyframes exit': {
          to: {
            opacity: 'var(--tw-exit-opacity, 1)',
            transform:
              'translate3d(0, var(--tw-exit-translate-y, 0), 0) scale3d(var(--tw-exit-scale, 1), var(--tw-exit-scale, 1), var(--tw-exit-scale, 1))',
          },
        },
        '.animate-in': {
          animationName: 'enter',
          animationDuration: '150ms',
          '--tw-enter-opacity': 'initial',
          '--tw-enter-scale': 'initial',
          '--tw-enter-translate-y': 'initial',
        },
        '.animate-out': {
          animationName: 'exit',
          animationDuration: '150ms',
          '--tw-exit-opacity': 'initial',
          '--tw-exit-scale': 'initial',
          '--tw-exit-translate-y': 'initial',
        },
        '.fade-in-0': { '--tw-enter-opacity': '0' },
        '.fade-out-0': { '--tw-exit-opacity': '0' },
        '.zoom-in-99': { '--tw-enter-scale': '0.99' },
        '.zoom-out-99': { '--tw-exit-scale': '0.99' },
        '.slide-in-from-bottom-0': { '--tw-enter-translate-y': '0px' },
        '.slide-in-from-bottom-4': { '--tw-enter-translate-y': '1rem' },
        '.slide-out-to-bottom-0': { '--tw-exit-translate-y': '0px' },
        '.slide-out-to-bottom-4': { '--tw-exit-translate-y': '1rem' },
      })
      matchUtilities(
        { duration: (value) => ({ animationDuration: value }) },
        { values: theme('transitionDuration') },
      )
    }),
  ],
}
