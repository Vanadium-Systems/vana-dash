import i18next from 'eslint-plugin-i18next'
import tseslint from 'typescript-eslint'

// Folders whose texts live in src/locales. A literal written in JSX there fails the lint;
// the list grows until it is the whole of src.
const TRANSLATED = ['src/shared/lib/**/*.{ts,tsx}']

// Things that read the same in every language.
const NOT_TEXT = [
  '[0-9!-/:-@[-`{-~\\s]+',
  '[A-Z0-9_./%+·•→←↑↓×≈—–-]+',
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
