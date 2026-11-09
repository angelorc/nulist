import { defineConfig } from 'oxlint'

const ignored = [
  '**/.nuxt/**',
  '**/.output/**',
  '**/.data/**',
  '**/.workflow-data/**',
  '**/.turbo/**',
  '**/dist/**',
  '**/coverage/**',
  'apps/web/server/db/migrations/**',
  '.agent/**',
  '.agents/**',
  '.claude/**',
  '.codex/**',
  '.continue/**',
  '.cursor/**',
  '.gemini/**',
  '.opencode/**',
  '.pi/**',
  '.roo/**',
  '.windsurf/**',
  'tools/oxlint/anti-slop/**'
]

export default defineConfig({
  // Listing plugins replaces the defaults, so the default set is repeated here.
  plugins: ['eslint', 'typescript', 'unicorn', 'oxc', 'import', 'promise', 'node', 'vue'],
  jsPlugins: [{ name: 'anti-slop', specifier: './tools/oxlint/anti-slop/index.ts' }],
  categories: { correctness: 'error', suspicious: 'warn', perf: 'warn' },
  env: { builtin: true, es2024: true, browser: true, node: true },
  options: { typeAware: true, reportUnusedDisableDirectives: 'warn' },
  ignorePatterns: ignored,
  rules: {
    // Nuxt/Nitro auto-imports and Vue compiler macros are resolved by vue-tsc, not by oxlint.
    'eslint/no-undef': 'off',
    // h3 idiom `readValidatedBody(event, schema.parse)`: zod 4 parse functions are bound.
    'typescript/unbound-method': 'off',

    'oxc/no-accumulating-spread': 'error',
    'anti-slop/no-array-filter-map': 'error',
    'anti-slop/no-reduce-accumulator-copy': 'error',
    'anti-slop/no-chained-type-assertions': 'error',
    'anti-slop/no-conditional-empty-object-spread': 'error',
    'anti-slop/no-known-value-widening': 'error',
    'anti-slop/no-module-mocking': 'error',
    'anti-slop/no-object-parameters': 'error',
    'anti-slop/no-reflect-apply': 'error',
    'anti-slop/no-reflect-get': 'error',
    'anti-slop/no-runtime-typeof': 'error',
    'anti-slop/no-shape-in-symbol-names': 'error',
    'anti-slop/no-unknown-parameters': 'error',
    'anti-slop/no-unknown-returns': 'error',
    'anti-slop/no-unknown-type-aliases': 'error',
    'anti-slop/no-unsafe-dictionary-type': 'error',
    'anti-slop/no-widen-then-assert': 'error',
    'anti-slop/require-readable-spacing': 'error',
    'anti-slop/require-safety-comment-for-type-assertion': 'error'
  },
  overrides: [
    {
      files: ['**/tests/**', '**/*.test.ts', '**/*.spec.ts'],
      plugins: ['vitest'],
      rules: { 'vitest/no-focused-tests': 'error' }
    }
  ]
})
