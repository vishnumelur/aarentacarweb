import { resolve } from 'node:path'
import { config } from 'dotenv'
import { defineConfig } from 'vitest/config'

config({ path: resolve(import.meta.dirname, '../../.env') })

export default defineConfig({
  // Mirrors tsconfig.json's `"@/*": ["./src/*"]` so route handlers under
  // `src/app/**` can use the same `@/...` imports Next.js itself resolves at
  // build time — vite (which runs the tests) does not read tsconfig `paths`.
  resolve: {
    alias: { '@': resolve(import.meta.dirname, './src') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./tests/setup.ts'],
    setupFiles: ['./tests/env.ts'],
    fileParallelism: false,
  },
})
