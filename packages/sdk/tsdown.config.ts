import { defineConfig } from 'tsdown'

/**
 * Dual ESM + CJS build (`.mjs` / `.cjs` with `.d.mts` / `.d.cts`) and no runtime dependencies.
 * Declaration maps are emitted (the declarations reference them) and point into the published `src`.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  platform: 'neutral',
  fixedExtension: true,
  target: 'es2022',
  dts: { sourcemap: true },
  clean: true,
  sourcemap: true
})
