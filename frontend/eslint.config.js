import i18next from 'eslint-plugin-i18next'
import tseslint from 'typescript-eslint'

// Every text shown to a person lives in src/locales, in each language. A literal written in JSX
// fails the lint.
const TRANSLATED = ['src/**/*.{ts,tsx}']

// Things that read the same in every language.
const NOT_TEXT = [
  '[0-9!-/:-@[-`{-~\\s]+',
  '[A-Z0-9_./%+:$&() ·•→←↑↓×≈⚠▸▾★▍„”"−—–-]+',
  'https?://.*',
  '/[\\w#./-]*',
  '(stroke|fill|text|bg)-[a-z -]+',
  '[A-Z][a-z]+/[A-Z][A-Za-z_]+',
  // product, provider and market names
  '(Crypto · )?Binance',
  'Trading212',
  'Finnhub',
  'Twelve Data',
  'Revolut Business',
  'S&P 500 / Nasdaq 100',
  'P&L',
  'dex/',
  'CPU / RAM / Disk',
  'dash \\(VPS\\)',
  'Fear & Greed',
  '\\.env',
  '(ANAF )?SPV / e-Factura',
  'ANAF SPV / e-Factura',
  'Vanagreen',
  '[/›»]',
  // identifiers passed around inside JSX: feature keys, variants, Intl options, query params
  '[a-z0-9]+([-_:./][a-zA-Z0-9]+)*',
  '[a-z]+[A-Z][a-zA-Z0-9]*',
  '© \\d+ Vanadium Systems SRL',
  'VanaDash',
  'VanaGreen',
  'Vanadium Systems',
  'e-Factura',
  'Email',
  'Revolut',
  'SICAP',
  'Markdown',
]

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: TRANSLATED,
    ignores: ['src/**/*.test.{ts,tsx}'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-only',
          'jsx-attributes': { include: ['placeholder', 'title', 'aria-label', 'alt', 'label', 'description'] },
          words: { exclude: NOT_TEXT },
          message: 'Text belongs in src/locales (ro and en); read it with t().',
        },
      ],
    },
  },
)
