import { defineConfig } from 'oxfmt'

export default defineConfig({
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: false,
  singleQuote: true,
  trailingComma: 'none',
  arrowParens: 'always',
  bracketSpacing: true,
  endOfLine: 'lf',
  insertFinalNewline: true,
  vueIndentScriptAndStyle: false,
  sortPackageJson: false,
  ignorePatterns: [
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
    // Vendored upstream keeps its own style so future three-way updates stay clean.
    'tools/oxlint/anti-slop/**',
    'skills-lock.json'
  ]
})
