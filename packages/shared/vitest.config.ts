import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // index.ts is re-exports only; types.ts files carry no executable code.
      exclude: ['src/index.ts', 'src/**/types.ts'],
      reporter: ['text', 'json-summary'],
      // NFR-9: the pricing engine, availability engine and state machine are
      // covered at 90%+. These are the functions every screen depends on.
      thresholds: {
        // NFR-9 requires each engine at 90%+, not the average. Without perFile a
        // well-covered module can mask another decaying to 50% while CI stays green.
        perFile: true,
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
})
