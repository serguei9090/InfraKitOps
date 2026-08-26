import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, mergeConfig } from 'vite'
import { defineConfig as defineVitestConfig } from 'vitest/config'

// https://vite.dev/config/  https://vitest.dev/config/
// Merged rather than built with vitest/config's defineConfig directly — vitest
// bundles its own (older) copy of Vite's plugin types, which collides with
// this project's newer Vite/Rolldown types if the plugins array is typed
// through vitest/config. Keeping the plugins under plain Vite's defineConfig
// and merging the `test` block in separately sidesteps that.
const viteConfig = defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
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
      environment: 'node',
    },
  }),
)
