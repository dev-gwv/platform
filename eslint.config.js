// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.output/**',
      '**/.nitro/**',
      '**/node_modules/**',
      'extracted/**',
      'blueprint/**',
      'docs-reverse-engineered/**',
      // Reference checkouts read for design, never built or shipped. Git
      // ignores them; eslint keeps its own list, so a clone that drops one of
      // these in reports thousands of errors from code we do not own.
      'twenty-orbitcrew-main/**',
      'ipc-control-center-main/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Browser snippets pasted into a page's console, not modules we build.
    files: ['docs/**/*.js'],
    languageOptions: {
      globals: { window: 'readonly', document: 'readonly', CSS: 'readonly', location: 'readonly', getComputedStyle: 'readonly' },
    },
  },
  {
    // Standalone Node scripts (run manually via bun), not part of the app build.
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', fetch: 'readonly' },
    },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  {
    /**
     * Two screens shipped as a white "Something went wrong" page because a
     * useMemo sat below an `if (isLoading) return` — the hook count changed
     * the moment the query resolved and React threw. Typecheck and tests both
     * stay green for that, so the only thing that catches it is this rule.
     */
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  prettier,
)
