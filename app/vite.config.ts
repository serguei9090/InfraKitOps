import { readFileSync } from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, mergeConfig } from 'vite'
import { defineConfig as defineVitestConfig } from 'vitest/config'

const appVersion = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, './package.json'), 'utf8'),
).version as string

// https://vite.dev/config/  https://vitest.dev/config/
// Merged rather than built with vitest/config's defineConfig directly — vitest
// bundles its own (older) copy of Vite's plugin types, which collides with
// this project's newer Vite/Rolldown types if the plugins array is typed
// through vitest/config. Keeping the plugins under plain Vite's defineConfig
// and merging the `test` block in separately sidesteps that.
const viteConfig = defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    // pdf-lib (~205 kB gzip) is a deliberate lazy chunk — don't warn on it.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Keep the framework in a stable chunk so a tool-screen change doesn't
        // bust it; the per-route chunks come from `lazy:` in routes.tsx.
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return 'vendor-react'
          }
        },
      },
    },
  },
  // Tauri expects a fixed, predictable port — see https://v2.tauri.app/start/frontend/vite/
  server: {
    port: 1420,
    strictPort: true,
  },
})

export default mergeConfig(
  viteConfig,
  defineVitestConfig({
    test: {
      // Core logic (*.test.ts) runs on node — fast, no DOM. Component tests
      // (*.test.tsx) opt into a DOM with a `@vitest-environment happy-dom`
      // docblock at the top of the file.
      environment: 'node',
    },
  }),
)
