import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./tests/setup.ts'],
    setupFiles: ['dotenv/config'],
    fileParallelism: false,
  },
})
