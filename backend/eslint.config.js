import tseslint from 'typescript-eslint'

// PLAN E1: every error answer goes through `fail()` / `httpError()` (shared/lib/http-error.ts),
// so it has a stable code and a text in the reader's language, never the text of an exception.
const errorShape = [
  {
    selector: "ObjectExpression:has(> Property[key.name='success'][value.value=false]):has(> Property[key.name='error'])",
    message: 'Answer errors with fail(reply, status, CODE) or throw httpError(status, CODE) from shared/lib/http-error.ts.',
  },
]

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/shared/lib/http-error.ts'],
    rules: {
      'no-restricted-syntax': ['warn', ...errorShape],
    },
  },
)
