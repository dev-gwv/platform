// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * A WhatsApp link is built in one place: `waLink` / `waShare` /
 * `waLinkOrShare` in packages/domain/src/whatsapp.ts. Hand-built ones drifted
 * into six rules -- a ten-digit number with no country code opened a chat
 * with nobody, and none took a typed leading 0. `wa.me/message/…` (a
 * business's own short link, typed by the studio) is not a number and stays
 * allowed. (`\x2F` is "/": esquery's regex cannot hold a bare slash.)
 */
const WA_PATTERN = '/(wa\\.me\\x2F(?!message)|api\\.whatsapp\\.com\\x2Fsend)/'
const WA_MESSAGE = 'Build WhatsApp links with waLink / waShare / waLinkOrShare from @ipc/domain (packages/domain/src/whatsapp.ts), never by hand.'
const noHandBuiltWhatsApp = [
  { selector: `Literal[value=${WA_PATTERN}]`, message: WA_MESSAGE },
  { selector: `TemplateElement[value.raw=${WA_PATTERN}]`, message: WA_MESSAGE },
]
const WA_ALLOWED = ['packages/domain/src/whatsapp.ts', '**/*.test.{ts,tsx}']

/**
 * An effect written `useEffect(() => el.scrollIntoView(), …)` returns
 * whatever the call returns, and React keeps it as the cleanup. Chrome 150
 * made scrollIntoView return a Promise, so the next re-run "called" it and
 * the deliverable panel crashed ("He is not a function"). An effect's body
 * is a block, always.
 */
const effectBlockBody = {
  selector:
    "CallExpression[callee.name=/^use(Layout)?Effect$/] > ArrowFunctionExpression[expression=true]:not([body.type='ArrowFunctionExpression']):not([body.type='Identifier'])",
  message: 'Give the effect a block body: `useEffect(() => { … }, deps)`. An expression body returns its value as the cleanup.',
}

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
    // The desktop app (Electron's main process and preload): CommonJS on Node.
    files: ['native/desktop/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        __dirname: 'readonly',
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        setImmediate: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // The support group bot (deploy/wa-bot): a Node service, not part of the app build.
    files: ['deploy/wa-bot/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', Buffer: 'readonly', URL: 'readonly' },
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
      'no-restricted-syntax': ['error', effectBlockBody],
    },
  },
  {
    // The WhatsApp rule. A later no-restricted-syntax replaces an earlier one
    // instead of adding to it, so the web app's code carries the effect rule again.
    files: ['apps/web/**/*.{ts,tsx}'],
    ignores: WA_ALLOWED,
    rules: { 'no-restricted-syntax': ['error', effectBlockBody, ...noHandBuiltWhatsApp] },
  },
  {
    files: ['services/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    ignores: WA_ALLOWED,
    rules: { 'no-restricted-syntax': ['error', ...noHandBuiltWhatsApp] },
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
