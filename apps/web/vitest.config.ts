import { resolve } from 'node:path'
import { config } from 'dotenv'
import { defineConfig } from 'vitest/config'

config({ path: resolve(import.meta.dirname, '../../.env') })

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./tests/setup.ts'],
    setupFiles: ['./tests/env.ts'],
    fileParallelism: false,
  },
})
