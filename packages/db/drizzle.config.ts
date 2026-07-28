import { resolve } from 'node:path'
import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

// drizzle-kit bundles this file as CJS, where `import.meta.dirname` is unavailable,
// so resolve relative to cwd — drizzle-kit is always invoked from packages/db.
config({ path: resolve(process.cwd(), '../../.env') })

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
})
