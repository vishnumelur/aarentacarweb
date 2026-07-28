import { resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'
import type { NextConfig } from 'next'

// Next loads `.env` from the app directory (`apps/web/.env`), but in this monorepo
// the file lives once at the workspace root (`vitest.config.ts` and `tests/env.ts`
// already load it from there for the test runner). Without this, `next dev`/`build`/
// `start` start up cleanly — nothing here throws — and then every route that touches
// the database 500s on its first request with "DATABASE_URL is not set". A missing
// file at this path (e.g. in CI, which injects real environment variables directly)
// is not an error: `dotenv`'s `config()` returns `{ error }` rather than throwing, so
// the build is not broken by its absence — this call is intentionally not awaited or
// asserted on.
loadEnv({ path: resolve(import.meta.dirname, '../../.env') })

const config: NextConfig = {
  // The workspace packages ship raw TypeScript rather than a build artefact, so Next
  // must compile them. Recorded in P1-02-FOLLOW-UPS.md as a known packaging trait.
  transpilePackages: ['@aa/db', '@aa/shared'],
  // `@aa/db` and `@aa/shared` write internal relative imports the Node-ESM way —
  // `./client.js` pointing at `client.ts` — which Vitest/Vite resolve automatically
  // but Turbopack does not; a route handler pulling in `@aa/db` fails to compile
  // under Turbopack with "Module not found: Can't resolve './client.js'". Discovered
  // in Task 7 (P1.3), the first code path to actually reach `@aa/db` from the app
  // router. `extensionAlias` is the fix, but Next only honours it under webpack
  // (Turbopack ignores it, with a startup warning) — hence `apps/web/package.json`'s
  // `dev`/`build` scripts passing `--webpack` explicitly rather than relying on
  // Next 16's Turbopack-by-default.
  experimental: {
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
}

export default config
