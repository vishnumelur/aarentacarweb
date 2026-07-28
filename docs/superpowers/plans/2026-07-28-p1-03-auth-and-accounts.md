# P1.3 Auth & Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `apps/web` — the first Next.js application — with phone-OTP login for customers, email plus TOTP for staff and owner, sessions in Postgres, four roles with branch scoping, and the PDPL export and anonymise path. Ends with `pnpm dev` serving a working login page.

**Architecture:** Next.js 16 App Router. Auth logic lives in `apps/web/src/auth/` as functions taking their dependencies as parameters — a database handle, a clock, a notification driver — so every one is testable against a real Postgres with no HTTP and no mocks. Route handlers are thin wrappers that parse, call, and set cookies. Sessions are opaque random tokens stored hashed; nothing is a JWT.

**Tech Stack:** Next.js 16 · React 19 · TypeScript strict · Drizzle (`@aa/db`) · `@node-rs/argon2` · `otpauth` (TOTP) · Zod · Vitest

## Global Constraints

- **Node 24 LTS. TypeScript strict, `noUncheckedIndexedAccess`, no `any`.**
- **No mocking of things that matter.** Sessions and OTPs are tested against the real Postgres already running on `localhost:5432`. The clock is injected as a `() => Date` parameter — never `Date.now()` inside a function under test. Notifications go through the `NotificationDriver` interface, and tests use a recording in-memory driver, not a mock framework.
- **Passwords hashed with Argon2id** (NFR-3). Never bcrypt, never a bare hash.
- **Sessions are HTTP-only, Secure, SameSite cookies** (NFR-3). The cookie carries an opaque token; the database stores only its SHA-256 hash, so a database leak does not yield usable sessions.
- **Phone is the primary identifier** (FR-13.1). Email is optional and secondary.
- **OTP codes expire after 5 minutes, are limited to 5 attempts, and are rate-limited per number and per IP** (FR-13.3).
- **Account lockout after 10 failed attempts, released by staff or after 30 minutes** (FR-13.9).
- **Sessions expire after 30 days of inactivity for customers, 12 hours for staff and owner** (FR-13.7).
- **Staff, chauffeur and owner accounts are created by an administrator, never self-registered** (FR-13.6).
- **Staff and owner accounts require TOTP two-factor** (FR-11.2).
- **Every privileged mutation is written to the audit log with actor, before and after** (FR-11.3).
- **Deletion anonymises rather than removes** where financial records must be retained (FR-13.8, NFR-12).
- **English only** (NFR-5). Layouts use logical CSS properties; no translation infrastructure.
- **Store UTC, render Asia/Dubai.** Use `dubaiDate`/`dubaiTimeOfDay` from `@aa/shared` for any user-facing date — never `toISOString().slice(0,10)`.
- Files stay focused; past roughly 300 lines is a signal to split.

## Context from P1.1 and P1.2

`packages/db` provides the schema. Relevant tables already exist — **this plan adds no migrations except Task 4's**:

- `users` — `id`, `phone` (unique, not null), `email` (unique, nullable), `fullName`, `role` (`customer|chauffeur|staff|owner`), `passwordHash`, `totpSecret`, `branchId` (FK to branches), `isActive`, `lockedUntil`, `failedLoginCount` (integer), `createdAt`, `updatedAt`
- `sessions` — `id`, `userId` (cascade), `tokenHash` (unique), `ipAddress`, `userAgent`, `expiresAt`, `createdAt`
- `customers` — `id`, `userId` (unique), `isBlacklisted`, `blacklistReason`, `internalNotes`
- `auditLog` — `id`, `actorUserId`, `entityType`, `entityId`, `action`, `before` (jsonb), `after` (jsonb), `ipAddress`, `createdAt`. Append-only by convention.
- `settings` — key/value jsonb, with `isSecret`

`packages/shared` provides `dubaiDate`, `dubaiTimeOfDay` and the booking state machine. It is pure — no I/O — and this app may import it freely.

`packages/db/tests/db.ts` exports `withTestDb()`; `tests/setup.ts` is a vitest `globalSetup` that starts an embedded Postgres when nothing is listening on `DATABASE_URL_TEST`'s port. **`apps/web` needs the same harness** — Task 1 wires it.

Carried-forward constraints that bind this plan, from `docs/superpowers/plans/P1-02-FOLLOW-UPS.md`:
- `QuoteInputSchema` types dates as bare `z.string()`; tighten when this app validates booking input (not this plan).
- `packages/shared/package.json` points `main` at raw TypeScript, so **Next.js needs `transpilePackages: ['@aa/shared', '@aa/db']`**.

## File structure

```
apps/web/
├── package.json
├── next.config.ts            transpilePackages for the workspace packages
├── tsconfig.json
├── vitest.config.ts          globalSetup reusing the embedded-Postgres harness
├── src/
│   ├── auth/
│   │   ├── clock.ts          Clock type and the system implementation
│   │   ├── notify.ts         NotificationDriver interface + console + recording drivers
│   │   ├── password.ts       Argon2id hash and verify
│   │   ├── totp.ts           TOTP secret generation and verification
│   │   ├── otp.ts            request and verify a phone OTP
│   │   ├── session.ts        create, resolve, revoke; cookie name and options
│   │   └── guard.ts          requireUser / requireRole / requireBranch
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx          placeholder home
│   │   ├── login/page.tsx    the phone-OTP login screen
│   │   └── api/v1/auth/
│   │       ├── otp/request/route.ts
│   │       ├── otp/verify/route.ts
│   │       ├── logout/route.ts
│   │       └── me/route.ts
│   └── db.ts                 the app's database handle
└── tests/
    ├── setup.ts, env.ts      mirroring packages/db
    ├── password.test.ts
    ├── totp.test.ts
    ├── otp.test.ts
    ├── session.test.ts
    ├── guard.test.ts
    └── routes.test.ts        real HTTP against the route handlers
```

Auth logic is split by responsibility, not by layer: `otp.ts` changes when OTP policy changes, `session.ts` when session policy does. They have no reason to change together.

---

### Task 1: `apps/web` scaffold and test harness

**Files:**
- Create: `apps/web/package.json`, `next.config.ts`, `tsconfig.json`, `vitest.config.ts`
- Create: `apps/web/src/db.ts`, `apps/web/src/auth/clock.ts`
- Create: `apps/web/tests/env.ts`, `apps/web/tests/setup.ts`
- Create: `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`
- Test: `apps/web/tests/harness.test.ts`

**Interfaces:**
- Consumes: `@aa/db` (`createDb`, schema), `@aa/shared`.
- Produces:
  - `type Clock = () => Date` and `systemClock: Clock`
  - `getAppDb()` — the app's database handle
  - A vitest harness that runs against a real Postgres, mirroring `packages/db`

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/harness.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { getAppDb } from '../src/db.js'
import { systemClock, type Clock } from '../src/auth/clock.js'

describe('app test harness', () => {
  it('reaches a real Postgres, not a mock', async () => {
    const db = getAppDb()
    const r = await db.execute<{ server_version: string }>(sql`SHOW server_version`)
    expect(Number(String(r.rows[0]!.server_version).split('.')[0])).toBeGreaterThanOrEqual(17)
  })

  it('runs the database in UTC', async () => {
    const r = await getAppDb().execute<{ TimeZone: string }>(sql`SHOW timezone`)
    expect(r.rows[0]!.TimeZone).toBe('UTC')
  })

  it('can see the tables P1.1 migrated', async () => {
    const r = await getAppDb().execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)
    const names = r.rows.map((x) => x.table_name)
    for (const t of ['users', 'sessions', 'customers', 'audit_log']) {
      expect(names, `${t} must exist`).toContain(t)
    }
  })

  it('exposes an injectable clock rather than reading time internally', () => {
    const fixed: Clock = () => new Date('2026-08-01T10:00:00Z')
    expect(fixed().toISOString()).toBe('2026-08-01T10:00:00.000Z')
    // The system clock is real, and every auth function takes a Clock parameter so
    // expiry can be tested without waiting.
    expect(systemClock()).toBeInstanceOf(Date)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aa/web test`
Expected: FAIL — the package does not exist, so pnpm reports no matching project.

- [ ] **Step 3: Write minimal implementation**

`apps/web/package.json`:

```json
{
  "name": "@aa/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start --port 3000",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@aa/db": "workspace:*",
    "@aa/shared": "workspace:*",
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "dotenv": "^16.4.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

`apps/web/next.config.ts`:

```typescript
import type { NextConfig } from 'next'

const config: NextConfig = {
  // The workspace packages ship raw TypeScript rather than a build artefact, so Next
  // must compile them. Recorded in P1-02-FOLLOW-UPS.md as a known packaging trait.
  transpilePackages: ['@aa/db', '@aa/shared'],
}

export default config
```

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "jsx": "preserve",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowJs": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "next-env.d.ts", ".next/types/**/*.ts"]
}
```

`apps/web/tests/env.ts`:

```typescript
import { resolve } from 'node:path'
import { config } from 'dotenv'

config({ path: resolve(import.meta.dirname, '../../../.env') })
```

`apps/web/tests/setup.ts` — reuse the harness `packages/db` already proved:

```typescript
import { resolve } from 'node:path'
import { config } from 'dotenv'

config({ path: resolve(import.meta.dirname, '../../../.env') })

/**
 * The app's tests run against whatever Postgres `DATABASE_URL_TEST` names. In
 * development that is the Docker container; in CI it is the service container.
 * `packages/db`'s own globalSetup already applies migrations, so this file only
 * asserts the database is reachable — a missing database must fail loudly rather
 * than let a suite report success having tested nothing.
 */
export async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL_TEST
  if (!url) {
    console.error('FATAL: DATABASE_URL_TEST is not set — refusing to run with no database.')
    process.exit(1)
  }
  const net = await import('node:net')
  const port = Number(new URL(url).port || '5432')
  const reachable = await new Promise<boolean>((res) => {
    const s = net.connect({ port, host: 'localhost' })
    const done = (v: boolean) => { s.destroy(); res(v) }
    s.once('connect', () => done(true))
    s.once('error', () => done(false))
    s.setTimeout(1000, () => done(false))
  })
  if (!reachable) {
    console.error(`FATAL: nothing listening on localhost:${port}. Start the dev stack:`)
    console.error('  docker compose -f docker-compose.dev.yml up -d')
    process.exit(1)
  }
}
```

`apps/web/vitest.config.ts`:

```typescript
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
```

`apps/web/src/db.ts`:

```typescript
import { createDb } from '@aa/db'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '@aa/db/src/schema/index.js'

let cached: NodePgDatabase<typeof schema> | undefined

/**
 * The application's database handle. Tests point at DATABASE_URL_TEST; the running
 * app points at DATABASE_URL.
 */
export function getAppDb(): NodePgDatabase<typeof schema> {
  if (!cached) {
    const url = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL
    if (!url) throw new Error('Neither DATABASE_URL_TEST nor DATABASE_URL is set')
    cached = createDb(url)
  }
  return cached
}
```

If `@aa/db`'s exports do not expose the schema at that path, add an `exports` field to `packages/db/package.json` rather than reaching into `src/` — and say so in your report.

`apps/web/src/auth/clock.ts`:

```typescript
/**
 * Time is a dependency, not an ambient fact.
 *
 * Every auth function takes a Clock so expiry, lockout and rate-limit windows can be
 * tested by advancing a fixed date rather than by sleeping. A function calling
 * `Date.now()` internally cannot be tested for what it does five minutes from now.
 */
export type Clock = () => Date

export const systemClock: Clock = () => new Date()
```

`apps/web/src/app/layout.tsx`:

```tsx
export const metadata = {
  title: 'AA Rentals — Car Rental in Dubai',
  description: 'Self-drive and chauffeur car rental across Dubai.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

`apps/web/src/app/page.tsx`:

```tsx
export default function Home() {
  return (
    <main>
      <h1>AA Rentals</h1>
      <p>Car rental in Dubai.</p>
      <a href="/login">Sign in</a>
    </main>
  )
}
```

Then `pnpm install` from the repo root.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aa/web test`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): scaffold the Next.js app with a real-database test harness"
```

---

### Task 2: Password hashing and TOTP

**Files:**
- Create: `apps/web/src/auth/password.ts`
- Create: `apps/web/src/auth/totp.ts`
- Test: `apps/web/tests/password.test.ts`, `apps/web/tests/totp.test.ts`

**Interfaces:**
- Consumes: `Clock` from Task 1.
- Produces:
  - `hashPassword(plain: string): Promise<string>`
  - `verifyPassword(hash: string, plain: string): Promise<boolean>`
  - `generateTotpSecret(): string`
  - `totpUri(secret: string, accountName: string): string`
  - `verifyTotp(secret: string, token: string, now: Date): boolean`

Implements NFR-3 (Argon2id) and FR-11.2 (TOTP for staff and owner).

- [ ] **Step 1: Write the failing test**

`apps/web/tests/password.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../src/auth/password.js'

describe('password hashing', () => {
  it('produces an Argon2id hash, not bcrypt or a bare digest', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash.startsWith('$argon2id$')).toBe(true)
  })

  it('verifies the correct password', async () => {
    const hash = await hashPassword('s3cret-passphrase')
    expect(await verifyPassword(hash, 's3cret-passphrase')).toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('s3cret-passphrase')
    expect(await verifyPassword(hash, 's3cret-passphras')).toBe(false)
    expect(await verifyPassword(hash, '')).toBe(false)
  })

  it('salts, so the same password hashes differently every time', async () => {
    const a = await hashPassword('same-password')
    const b = await hashPassword('same-password')
    expect(a).not.toBe(b)
    expect(await verifyPassword(a, 'same-password')).toBe(true)
    expect(await verifyPassword(b, 'same-password')).toBe(true)
  })

  it('returns false rather than throwing on a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false)
  })
})
```

`apps/web/tests/totp.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { generateTotpSecret, totpUri, verifyTotp } from '../src/auth/totp.js'
import * as OTPAuth from 'otpauth'

function codeAt(secret: string, at: Date): string {
  return new OTPAuth.TOTP({
    issuer: 'AA Rentals', label: 'test',
    secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30,
  }).generate({ timestamp: at.getTime() })
}

describe('TOTP', () => {
  it('generates a base32 secret', () => {
    const s = generateTotpSecret()
    expect(s).toMatch(/^[A-Z2-7]+$/)
    expect(s.length).toBeGreaterThanOrEqual(16)
  })

  it('generates different secrets each time', () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret())
  })

  it('builds an otpauth URI an authenticator app can read', () => {
    const uri = totpUri('JBSWY3DPEHPK3PXP', 'staff@aa-rentals.ae')
    expect(uri.startsWith('otpauth://totp/')).toBe(true)
    expect(uri).toContain('AA%20Rentals')
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP')
  })

  it('accepts the code valid at that instant', () => {
    const secret = generateTotpSecret()
    const now = new Date('2026-08-01T10:00:00Z')
    expect(verifyTotp(secret, codeAt(secret, now), now)).toBe(true)
  })

  it('rejects a code from far in the past', () => {
    const secret = generateTotpSecret()
    const now = new Date('2026-08-01T10:00:00Z')
    const old = codeAt(secret, new Date('2026-08-01T09:00:00Z'))
    expect(verifyTotp(secret, old, now)).toBe(false)
  })

  it('tolerates one period of clock skew either side', () => {
    const secret = generateTotpSecret()
    const now = new Date('2026-08-01T10:00:00Z')
    const justBefore = codeAt(secret, new Date('2026-08-01T09:59:45Z'))
    const justAfter = codeAt(secret, new Date('2026-08-01T10:00:15Z'))
    expect(verifyTotp(secret, justBefore, now)).toBe(true)
    expect(verifyTotp(secret, justAfter, now)).toBe(true)
  })

  it('rejects a malformed token rather than throwing', () => {
    const secret = generateTotpSecret()
    const now = new Date('2026-08-01T10:00:00Z')
    expect(verifyTotp(secret, '', now)).toBe(false)
    expect(verifyTotp(secret, 'abcdef', now)).toBe(false)
    expect(verifyTotp(secret, '12345678901234', now)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aa/web test tests/password.test.ts tests/totp.test.ts`
Expected: FAIL — `Cannot find module '../src/auth/password.js'`

- [ ] **Step 3: Write minimal implementation**

Add dependencies to `apps/web/package.json`: `"@node-rs/argon2": "^2.0.0"` and `"otpauth": "^9.3.0"`, then `pnpm install`.

`apps/web/src/auth/password.ts`:

```typescript
import { hash, verify } from '@node-rs/argon2'

/**
 * NFR-3 requires Argon2id. The defaults in @node-rs/argon2 follow the OWASP
 * recommendation; they are not tuned down for speed.
 */
export async function hashPassword(plain: string): Promise<string> {
  return hash(plain)
}

/**
 * Returns false for a malformed stored hash rather than throwing. A corrupt row must
 * fail the login, not crash the endpoint for every other user.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain)
  } catch {
    return false
  }
}
```

`apps/web/src/auth/totp.ts`:

```typescript
import * as OTPAuth from 'otpauth'

const ISSUER = 'AA Rentals'
const DIGITS = 6
const PERIOD_SECONDS = 30
/** One period either side, tolerating modest clock skew on a staff member's phone. */
const WINDOW = 1

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32
}

export function totpUri(secret: string, accountName: string): string {
  return new OTPAuth.TOTP({
    issuer: ISSUER, label: accountName,
    secret: OTPAuth.Secret.fromBase32(secret),
    digits: DIGITS, period: PERIOD_SECONDS,
  }).toString()
}

/**
 * `now` is a parameter, not `Date.now()`, so skew and expiry are testable without
 * sleeping. Returns false on any malformed input rather than throwing.
 */
export function verifyTotp(secret: string, token: string, now: Date): boolean {
  if (!/^\d{6}$/.test(token)) return false
  try {
    const totp = new OTPAuth.TOTP({
      issuer: ISSUER, label: 'verify',
      secret: OTPAuth.Secret.fromBase32(secret),
      digits: DIGITS, period: PERIOD_SECONDS,
    })
    return totp.validate({ token, timestamp: now.getTime(), window: WINDOW }) !== null
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aa/web test tests/password.test.ts tests/totp.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/auth apps/web/tests apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add argon2id password hashing and TOTP verification"
```

---

### Task 3: The notification driver

**Files:**
- Create: `apps/web/src/auth/notify.ts`
- Test: `apps/web/tests/notify.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface NotificationDriver { send(msg: OutboundMessage): Promise<void> }`
  - `type OutboundMessage = { channel: 'sms' | 'whatsapp' | 'email'; to: string; body: string }`
  - `consoleDriver: NotificationDriver`
  - `createRecordingDriver(): NotificationDriver & { sent: OutboundMessage[] }`
  - `driverFromEnv(env: string | undefined): NotificationDriver`

Implements FR-10 and the spec's `NOTIFY_DRIVER=console` contract. The production SMS provider is deliberately undecided — this interface is where it plugs in.

- [ ] **Step 1: Write the failing test**

`apps/web/tests/notify.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import {
  consoleDriver, createRecordingDriver, driverFromEnv, type OutboundMessage,
} from '../src/auth/notify.js'

describe('notification driver', () => {
  it('records what was sent, so tests assert on real behaviour not a mock', async () => {
    const driver = createRecordingDriver()
    const msg: OutboundMessage = { channel: 'sms', to: '+971501234567', body: 'Your code is 123456' }
    await driver.send(msg)
    expect(driver.sent).toHaveLength(1)
    expect(driver.sent[0]).toEqual(msg)
  })

  it('records every message in order', async () => {
    const driver = createRecordingDriver()
    await driver.send({ channel: 'sms', to: '+971500000001', body: 'first' })
    await driver.send({ channel: 'whatsapp', to: '+971500000002', body: 'second' })
    expect(driver.sent.map((m) => m.body)).toEqual(['first', 'second'])
  })

  it('console driver writes rather than reaching a real phone', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    await consoleDriver.send({ channel: 'sms', to: '+971501234567', body: 'Your code is 999111' })
    expect(spy).toHaveBeenCalled()
    const line = spy.mock.calls.flat().join(' ')
    expect(line).toContain('+971501234567')
    expect(line).toContain('999111')
    spy.mockRestore()
  })

  it('defaults to the console driver when NOTIFY_DRIVER is unset', () => {
    expect(driverFromEnv(undefined)).toBe(consoleDriver)
    expect(driverFromEnv('console')).toBe(consoleDriver)
  })

  it('refuses to start with a live driver that has no implementation yet', () => {
    // The SMS provider is deliberately undecided. Selecting it must fail loudly at
    // startup rather than silently swallowing every OTP a customer waits for.
    expect(() => driverFromEnv('live')).toThrow(/no live notification provider/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aa/web test tests/notify.test.ts`
Expected: FAIL — `Cannot find module '../src/auth/notify.js'`

- [ ] **Step 3: Write minimal implementation**

`apps/web/src/auth/notify.ts`:

```typescript
export type NotificationChannel = 'sms' | 'whatsapp' | 'email'

export interface OutboundMessage {
  readonly channel: NotificationChannel
  readonly to: string
  readonly body: string
}

export interface NotificationDriver {
  send(message: OutboundMessage): Promise<void>
}

/**
 * Development default. Writes to the console so a background job under test never
 * messages a real customer, and so an OTP is visible without an SMS account.
 */
export const consoleDriver: NotificationDriver = {
  async send(message) {
    console.info(`[notify:${message.channel}] to ${message.to}: ${message.body}`)
  },
}

/** Used by tests. Asserting on `sent` is asserting on behaviour, not on a mock. */
export function createRecordingDriver(): NotificationDriver & { sent: OutboundMessage[] } {
  const sent: OutboundMessage[] = []
  return {
    sent,
    async send(message) { sent.push(message) },
  }
}

export function driverFromEnv(value: string | undefined): NotificationDriver {
  if (value === undefined || value === 'console') return consoleDriver
  throw new Error(
    `NOTIFY_DRIVER='${value}': no live notification provider is implemented yet. ` +
    `The SMS provider is deliberately undecided — implement a NotificationDriver ` +
    `and register it here before setting this.`,
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aa/web test tests/notify.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/auth/notify.ts apps/web/tests/notify.test.ts
git commit -m "feat(web): add the notification driver interface with a console default"
```

---

### Task 4: OTP storage schema

**Files:**
- Create: `packages/db/src/schema/otp.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `packages/db/tests/otp.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: table `phoneOtps` — `id`, `phone`, `codeHash`, `expiresAt`, `attempts`, `consumedAt`, `ipAddress`, `createdAt`.

Implements FR-13.3. **This is the only migration in this plan.**

- [ ] **Step 1: Write the failing test**

`packages/db/tests/otp.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { withTestDb } from './db.js'
import { phoneOtps } from '../src/schema/index.js'

const db = withTestDb()

describe('phone OTP schema', () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE phone_otps RESTART IDENTITY CASCADE`)
  })

  it('stores only a hash of the code, never the code itself', async () => {
    const [row] = await db.insert(phoneOtps).values({
      phone: '+971501234567',
      codeHash: 'sha256-of-the-code',
      expiresAt: new Date('2026-08-01T10:05:00Z'),
      ipAddress: '94.200.1.1',
    }).returning()
    expect(row!.attempts).toBe(0)
    expect(row!.consumedAt).toBeNull()
    const columns = Object.keys(row!)
    expect(columns).not.toContain('code')
  })

  it('rejects a negative attempt count', async () => {
    await expect(db.insert(phoneOtps).values({
      phone: '+971501234567', codeHash: 'x',
      expiresAt: new Date('2026-08-01T10:05:00Z'), attempts: -1,
    })).rejects.toThrow(/attempts_non_negative/)
  })

  it('indexes by phone so the sweeper and lookup do not scan', async () => {
    const r = await db.execute<{ indexname: string }>(sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'phone_otps'`)
    expect(r.rows.map((x) => x.indexname).join(' ')).toContain('phone_otps_phone_idx')
  })

  it('allows several codes for one number, so a resend does not violate a constraint', async () => {
    const base = { phone: '+971509999999', codeHash: 'a', expiresAt: new Date('2026-08-01T10:05:00Z') }
    await db.insert(phoneOtps).values(base)
    await expect(db.insert(phoneOtps).values({ ...base, codeHash: 'b' })).resolves.toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aa/db test tests/otp.test.ts`
Expected: FAIL — no export named `phoneOtps`

- [ ] **Step 3: Write minimal implementation**

`packages/db/src/schema/otp.ts`:

```typescript
import { pgTable, uuid, text, integer, timestamp, check, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * FR-13.3 — a one-time code sent to a phone.
 *
 * Only the hash is stored. A database leak must not hand an attacker live codes, and
 * a code is short enough that storing it plainly is meaningfully worse than storing a
 * password. Several rows per phone are permitted so a resend does not collide; the
 * verifier takes the newest unconsumed one.
 */
export const phoneOtps = pgTable('phone_otps', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: text('phone').notNull(),
  codeHash: text('code_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('phone_otps_phone_idx').on(t.phone, t.createdAt),
  index('phone_otps_expiry_idx').on(t.expiresAt),
  check('attempts_non_negative', sql`${t.attempts} >= 0`),
])
```

Add `export * from './otp.js'` to `packages/db/src/schema/index.ts` — note the existing exports in that file use the no-suffix form for internal modules, so match whatever is already there.

Generate the migration:

```bash
pnpm --filter @aa/db generate
```

Confirm the new `.sql` appears and that migrations `0008`, `0010`, `0015`, `0016` and `0017` — which are hand-written — are untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aa/db test tests/otp.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/otp.ts packages/db/src/schema/index.ts packages/db/migrations packages/db/tests/otp.test.ts
git commit -m "feat(db): add phone OTP storage, hashed and rate-limitable"
```

---

### Task 5: Request and verify an OTP

**Files:**
- Create: `apps/web/src/auth/otp.ts`
- Test: `apps/web/tests/otp.test.ts`

**Interfaces:**
- Consumes: `Clock` (Task 1), `NotificationDriver` (Task 3), `phoneOtps` (Task 4).
- Produces:
  - `requestOtp(deps, input): Promise<RequestOtpResult>`
  - `verifyOtp(deps, input): Promise<VerifyOtpResult>`
  - `OTP_TTL_MINUTES = 5`, `OTP_MAX_ATTEMPTS = 5`, `OTP_RESEND_COOLDOWN_SECONDS = 60`

Implements FR-13.1 and FR-13.3.

- [ ] **Step 1: Write the failing test**

`apps/web/tests/otp.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { getAppDb } from '../src/db.js'
import { createRecordingDriver } from '../src/auth/notify.js'
import { requestOtp, verifyOtp, OTP_MAX_ATTEMPTS } from '../src/auth/otp.js'
import type { Clock } from '../src/auth/clock.js'

const db = getAppDb()
const PHONE = '+971501234567'

function at(iso: string): Clock { return () => new Date(iso) }
function codeFrom(driver: ReturnType<typeof createRecordingDriver>): string {
  const body = driver.sent.at(-1)!.body
  return body.match(/(\d{6})/)![1]!
}

describe('phone OTP', () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE phone_otps RESTART IDENTITY CASCADE`)
  })

  it('sends a six-digit code to the number given', async () => {
    const notify = createRecordingDriver()
    const r = await requestOtp({ db, notify, clock: at('2026-08-01T10:00:00Z') },
      { phone: PHONE, ipAddress: '94.200.1.1' })
    expect(r.ok).toBe(true)
    expect(notify.sent).toHaveLength(1)
    expect(notify.sent[0]!.to).toBe(PHONE)
    expect(notify.sent[0]!.channel).toBe('sms')
    expect(codeFrom(notify)).toMatch(/^\d{6}$/)
  })

  it('never returns the code to the caller', async () => {
    const notify = createRecordingDriver()
    const r = await requestOtp({ db, notify, clock: at('2026-08-01T10:00:00Z') }, { phone: PHONE })
    expect(JSON.stringify(r)).not.toContain(codeFrom(notify))
  })

  it('stores only a hash, never the code', async () => {
    const notify = createRecordingDriver()
    await requestOtp({ db, notify, clock: at('2026-08-01T10:00:00Z') }, { phone: PHONE })
    const rows = await db.execute<{ code_hash: string }>(sql`SELECT code_hash FROM phone_otps`)
    expect(rows.rows[0]!.code_hash).not.toBe(codeFrom(notify))
  })

  it('accepts the correct code', async () => {
    const notify = createRecordingDriver()
    const clock = at('2026-08-01T10:00:00Z')
    await requestOtp({ db, notify, clock }, { phone: PHONE })
    const r = await verifyOtp({ db, clock }, { phone: PHONE, code: codeFrom(notify) })
    expect(r.ok).toBe(true)
  })

  it('rejects a wrong code without consuming the OTP', async () => {
    const notify = createRecordingDriver()
    const clock = at('2026-08-01T10:00:00Z')
    await requestOtp({ db, notify, clock }, { phone: PHONE })
    const bad = await verifyOtp({ db, clock }, { phone: PHONE, code: '000000' })
    expect(bad.ok).toBe(false)
    expect(bad.reason).toBe('incorrect_code')
    // The real code still works afterwards.
    const good = await verifyOtp({ db, clock }, { phone: PHONE, code: codeFrom(notify) })
    expect(good.ok).toBe(true)
  })

  it('expires a code after five minutes (FR-13.3)', async () => {
    const notify = createRecordingDriver()
    await requestOtp({ db, notify, clock: at('2026-08-01T10:00:00Z') }, { phone: PHONE })
    const code = codeFrom(notify)
    // 4m59s later it still works.
    expect((await verifyOtp({ db, clock: at('2026-08-01T10:04:59Z') },
      { phone: PHONE, code })).ok).toBe(true)
  })

  it('refuses a code five minutes and one second old', async () => {
    const notify = createRecordingDriver()
    await requestOtp({ db, notify, clock: at('2026-08-01T10:00:00Z') }, { phone: PHONE })
    const r = await verifyOtp({ db, clock: at('2026-08-01T10:05:01Z') },
      { phone: PHONE, code: codeFrom(notify) })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('expired')
  })

  it('locks the code after five wrong attempts (FR-13.3)', async () => {
    const notify = createRecordingDriver()
    const clock = at('2026-08-01T10:00:00Z')
    await requestOtp({ db, notify, clock }, { phone: PHONE })
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await verifyOtp({ db, clock }, { phone: PHONE, code: '000000' })
    }
    // Even the correct code is now refused.
    const r = await verifyOtp({ db, clock }, { phone: PHONE, code: codeFrom(notify) })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('too_many_attempts')
  })

  it('cannot reuse a consumed code', async () => {
    const notify = createRecordingDriver()
    const clock = at('2026-08-01T10:00:00Z')
    await requestOtp({ db, notify, clock }, { phone: PHONE })
    const code = codeFrom(notify)
    expect((await verifyOtp({ db, clock }, { phone: PHONE, code })).ok).toBe(true)
    const again = await verifyOtp({ db, clock }, { phone: PHONE, code })
    expect(again.ok).toBe(false)
    expect(again.reason).toBe('no_pending_code')
  })

  it('rate-limits a resend within the cooldown', async () => {
    const notify = createRecordingDriver()
    await requestOtp({ db, notify, clock: at('2026-08-01T10:00:00Z') }, { phone: PHONE })
    const second = await requestOtp({ db, notify, clock: at('2026-08-01T10:00:30Z') }, { phone: PHONE })
    expect(second.ok).toBe(false)
    expect(second.reason).toBe('cooldown')
    expect(notify.sent).toHaveLength(1)
  })

  it('permits a resend after the cooldown, and the newest code wins', async () => {
    const notify = createRecordingDriver()
    await requestOtp({ db, notify, clock: at('2026-08-01T10:00:00Z') }, { phone: PHONE })
    const first = codeFrom(notify)
    const r = await requestOtp({ db, notify, clock: at('2026-08-01T10:01:01Z') }, { phone: PHONE })
    expect(r.ok).toBe(true)
    const second = codeFrom(notify)
    expect(second).not.toBe(first)
    const clock = at('2026-08-01T10:01:30Z')
    expect((await verifyOtp({ db, clock }, { phone: PHONE, code: second })).ok).toBe(true)
  })

  it('reports no pending code for a number that never requested one', async () => {
    const r = await verifyOtp({ db, clock: at('2026-08-01T10:00:00Z') },
      { phone: '+971500000000', code: '123456' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('no_pending_code')
  })

  it('rejects a malformed phone number', async () => {
    const notify = createRecordingDriver()
    const r = await requestOtp({ db, notify, clock: at('2026-08-01T10:00:00Z') },
      { phone: 'not-a-number' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid_phone')
    expect(notify.sent).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aa/web test tests/otp.test.ts`
Expected: FAIL — `Cannot find module '../src/auth/otp.js'`

- [ ] **Step 3: Write minimal implementation**

`apps/web/src/auth/otp.ts`:

```typescript
import { createHash, randomInt } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '@aa/db/src/schema/index.js'
import { phoneOtps } from '@aa/db/src/schema/index.js'
import type { Clock } from './clock.js'
import type { NotificationDriver } from './notify.js'

export const OTP_TTL_MINUTES = 5
export const OTP_MAX_ATTEMPTS = 5
export const OTP_RESEND_COOLDOWN_SECONDS = 60

/** E.164, permissive about country but requiring the leading plus. */
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/

export type RequestOtpReason = 'invalid_phone' | 'cooldown'
export type VerifyOtpReason =
  | 'no_pending_code' | 'expired' | 'incorrect_code' | 'too_many_attempts'

export type RequestOtpResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: RequestOtpReason }

export type VerifyOtpResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: VerifyOtpReason }

interface OtpDeps {
  readonly db: NodePgDatabase<typeof schema>
  readonly clock: Clock
}
interface RequestDeps extends OtpDeps {
  readonly notify: NotificationDriver
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/** Six digits, uniform, from a cryptographic source. */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/**
 * FR-13.1, FR-13.3 — sends a one-time code to a phone number.
 *
 * The code is never returned to the caller and never stored in plaintext, so neither
 * an API response nor a database dump hands anyone a live code.
 */
export async function requestOtp(
  deps: RequestDeps,
  input: { readonly phone: string; readonly ipAddress?: string },
): Promise<RequestOtpResult> {
  if (!PHONE_PATTERN.test(input.phone)) return { ok: false, reason: 'invalid_phone' }

  const now = deps.clock()

  const [latest] = await deps.db.select().from(phoneOtps)
    .where(eq(phoneOtps.phone, input.phone))
    .orderBy(desc(phoneOtps.createdAt)).limit(1)

  if (latest !== undefined) {
    const since = (now.getTime() - latest.createdAt.getTime()) / 1000
    if (since < OTP_RESEND_COOLDOWN_SECONDS) return { ok: false, reason: 'cooldown' }
  }

  const code = generateCode()
  await deps.db.insert(phoneOtps).values({
    phone: input.phone,
    codeHash: hashCode(code),
    expiresAt: new Date(now.getTime() + OTP_TTL_MINUTES * 60_000),
    ipAddress: input.ipAddress ?? null,
  })

  await deps.notify.send({
    channel: 'sms',
    to: input.phone,
    body: `Your AA Rentals code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
  })

  return { ok: true }
}

/**
 * Verifies a code and consumes it on success. A wrong code increments the attempt
 * counter without consuming, so a typo does not force a resend — but five wrong
 * attempts lock the code even against the correct value.
 */
export async function verifyOtp(
  deps: OtpDeps,
  input: { readonly phone: string; readonly code: string },
): Promise<VerifyOtpResult> {
  const now = deps.clock()

  const [pending] = await deps.db.select().from(phoneOtps)
    .where(and(eq(phoneOtps.phone, input.phone), isNull(phoneOtps.consumedAt)))
    .orderBy(desc(phoneOtps.createdAt)).limit(1)

  if (pending === undefined) return { ok: false, reason: 'no_pending_code' }
  if (pending.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' }
  if (pending.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'expired' }

  if (hashCode(input.code) !== pending.codeHash) {
    await deps.db.update(phoneOtps)
      .set({ attempts: pending.attempts + 1 })
      .where(eq(phoneOtps.id, pending.id))
    return { ok: false, reason: 'incorrect_code' }
  }

  await deps.db.update(phoneOtps)
    .set({ consumedAt: now })
    .where(eq(phoneOtps.id, pending.id))
  return { ok: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aa/web test tests/otp.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/auth/otp.ts apps/web/tests/otp.test.ts
git commit -m "feat(web): add phone OTP request and verification with expiry and attempt limits"
```

---

### Task 6: Sessions

**Files:**
- Create: `apps/web/src/auth/session.ts`
- Test: `apps/web/tests/session.test.ts`

**Interfaces:**
- Consumes: `Clock`, the `users` and `sessions` tables.
- Produces:
  - `createSession(deps, input): Promise<{ token: string; expiresAt: Date }>`
  - `resolveSession(deps, token): Promise<SessionUser | null>`
  - `revokeSession(deps, token): Promise<void>`
  - `revokeAllForUser(deps, userId): Promise<void>`
  - `SESSION_COOKIE = 'aa_session'`, `sessionCookieOptions(expiresAt)`
  - `CUSTOMER_SESSION_DAYS = 30`, `STAFF_SESSION_HOURS = 12`

Implements FR-13.7 and NFR-3.

- [ ] **Step 1: Write the failing test**

`apps/web/tests/session.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { sql, eq } from 'drizzle-orm'
import { getAppDb } from '../src/db.js'
import { users } from '@aa/db/src/schema/index.js'
import {
  createSession, resolveSession, revokeSession, revokeAllForUser,
  SESSION_COOKIE, sessionCookieOptions,
} from '../src/auth/session.js'
import type { Clock } from '../src/auth/clock.js'

const db = getAppDb()
function at(iso: string): Clock { return () => new Date(iso) }

async function makeUser(role: 'customer' | 'staff', phone: string) {
  const [u] = await db.insert(users)
    .values({ phone, fullName: 'Test User', role }).returning()
  return u!
}

describe('sessions', () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE sessions, customers, users RESTART IDENTITY CASCADE`)
  })

  it('issues an opaque token, not a JWT', async () => {
    const u = await makeUser('customer', '+971501111111')
    const { token } = await createSession({ db, clock: at('2026-08-01T10:00:00Z') },
      { userId: u.id, role: 'customer' })
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect(token.split('.')).toHaveLength(1)
  })

  it('stores only a hash of the token, so a database leak yields no usable session', async () => {
    const u = await makeUser('customer', '+971502222222')
    const { token } = await createSession({ db, clock: at('2026-08-01T10:00:00Z') },
      { userId: u.id, role: 'customer' })
    const rows = await db.execute<{ token_hash: string }>(sql`SELECT token_hash FROM sessions`)
    expect(rows.rows[0]!.token_hash).not.toBe(token)
    expect(rows.rows[0]!.token_hash).toHaveLength(64)
  })

  it('resolves a valid token to its user', async () => {
    const u = await makeUser('customer', '+971503333333')
    const clock = at('2026-08-01T10:00:00Z')
    const { token } = await createSession({ db, clock }, { userId: u.id, role: 'customer' })
    const resolved = await resolveSession({ db, clock }, token)
    expect(resolved?.userId).toBe(u.id)
    expect(resolved?.role).toBe('customer')
  })

  it('returns null for an unknown token', async () => {
    expect(await resolveSession({ db, clock: at('2026-08-01T10:00:00Z') }, 'nope')).toBeNull()
  })

  it('gives customers thirty days and staff twelve hours (FR-13.7)', async () => {
    const c = await makeUser('customer', '+971504444444')
    const s = await makeUser('staff', '+971505555555')
    const clock = at('2026-08-01T10:00:00Z')
    const cs = await createSession({ db, clock }, { userId: c.id, role: 'customer' })
    const ss = await createSession({ db, clock }, { userId: s.id, role: 'staff' })
    expect(cs.expiresAt.toISOString()).toBe('2026-08-31T10:00:00.000Z')
    expect(ss.expiresAt.toISOString()).toBe('2026-08-01T22:00:00.000Z')
  })

  it('refuses an expired session', async () => {
    const u = await makeUser('staff', '+971506666666')
    const { token } = await createSession({ db, clock: at('2026-08-01T10:00:00Z') },
      { userId: u.id, role: 'staff' })
    // One second past the twelve-hour window.
    expect(await resolveSession({ db, clock: at('2026-08-01T22:00:01Z') }, token)).toBeNull()
    // One second before it, still valid.
    expect(await resolveSession({ db, clock: at('2026-08-01T21:59:59Z') }, token)).not.toBeNull()
  })

  it('refuses a session belonging to a deactivated user', async () => {
    const u = await makeUser('staff', '+971507777777')
    const clock = at('2026-08-01T10:00:00Z')
    const { token } = await createSession({ db, clock }, { userId: u.id, role: 'staff' })
    await db.update(users).set({ isActive: false }).where(eq(users.id, u.id))
    expect(await resolveSession({ db, clock }, token)).toBeNull()
  })

  it('revokes a single session', async () => {
    const u = await makeUser('customer', '+971508888888')
    const clock = at('2026-08-01T10:00:00Z')
    const { token } = await createSession({ db, clock }, { userId: u.id, role: 'customer' })
    await revokeSession({ db, clock }, token)
    expect(await resolveSession({ db, clock }, token)).toBeNull()
  })

  it('revokes every session for a user at once (FR-21.6)', async () => {
    const u = await makeUser('staff', '+971509999999')
    const clock = at('2026-08-01T10:00:00Z')
    const a = await createSession({ db, clock }, { userId: u.id, role: 'staff' })
    const b = await createSession({ db, clock }, { userId: u.id, role: 'staff' })
    await revokeAllForUser({ db, clock }, u.id)
    expect(await resolveSession({ db, clock }, a.token)).toBeNull()
    expect(await resolveSession({ db, clock }, b.token)).toBeNull()
  })

  it('sets a cookie that JavaScript cannot read and a browser will not leak (NFR-3)', () => {
    const opts = sessionCookieOptions(new Date('2026-08-31T10:00:00Z'))
    expect(SESSION_COOKIE).toBe('aa_session')
    expect(opts.httpOnly).toBe(true)
    expect(opts.sameSite).toBe('lax')
    expect(opts.path).toBe('/')
    expect(opts.secure).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aa/web test tests/session.test.ts`
Expected: FAIL — `Cannot find module '../src/auth/session.js'`

- [ ] **Step 3: Write minimal implementation**

`apps/web/src/auth/session.ts`:

```typescript
import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '@aa/db/src/schema/index.js'
import { sessions, users } from '@aa/db/src/schema/index.js'
import type { Clock } from './clock.js'

export const SESSION_COOKIE = 'aa_session'

/** FR-13.7 — customers stay signed in far longer than staff, who share terminals. */
export const CUSTOMER_SESSION_DAYS = 30
export const STAFF_SESSION_HOURS = 12

export type UserRole = 'customer' | 'chauffeur' | 'staff' | 'owner'

export interface SessionUser {
  readonly userId: string
  readonly role: UserRole
  readonly branchId: string | null
  readonly fullName: string
}

interface SessionDeps {
  readonly db: NodePgDatabase<typeof schema>
  readonly clock: Clock
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function lifetimeMs(role: UserRole): number {
  return role === 'customer'
    ? CUSTOMER_SESSION_DAYS * 24 * 60 * 60_000
    : STAFF_SESSION_HOURS * 60 * 60_000
}

/**
 * NFR-3 — the cookie carries an opaque random token; the database stores only its
 * SHA-256. A leaked table therefore yields no usable session. Not a JWT: revocation
 * must be immediate, and a signed token cannot be withdrawn.
 */
export async function createSession(
  deps: SessionDeps,
  input: { readonly userId: string; readonly role: UserRole; readonly ipAddress?: string; readonly userAgent?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(deps.clock().getTime() + lifetimeMs(input.role))
  await deps.db.insert(sessions).values({
    userId: input.userId,
    tokenHash: hashToken(token),
    expiresAt,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  })
  return { token, expiresAt }
}

/** Returns null for unknown, expired, or deactivated-user sessions alike. */
export async function resolveSession(
  deps: SessionDeps,
  token: string,
): Promise<SessionUser | null> {
  const now = deps.clock()
  const [row] = await deps.db
    .select({
      userId: users.id, role: users.role, branchId: users.branchId,
      fullName: users.fullName, isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)))
    .limit(1)

  if (row === undefined || !row.isActive) return null
  return {
    userId: row.userId, role: row.role as UserRole,
    branchId: row.branchId, fullName: row.fullName,
  }
}

export async function revokeSession(deps: SessionDeps, token: string): Promise<void> {
  await deps.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
}

/** FR-21.6 — deactivating an account must end its sessions immediately. */
export async function revokeAllForUser(deps: SessionDeps, userId: string): Promise<void> {
  await deps.db.delete(sessions).where(eq(sessions.userId, userId))
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aa/web test tests/session.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/auth/session.ts apps/web/tests/session.test.ts
git commit -m "feat(web): add opaque-token sessions with role-based lifetimes"
```

---

### Task 7: Route handlers and the login page

**Files:**
- Create: `apps/web/src/app/api/v1/auth/otp/request/route.ts`
- Create: `apps/web/src/app/api/v1/auth/otp/verify/route.ts`
- Create: `apps/web/src/app/api/v1/auth/logout/route.ts`
- Create: `apps/web/src/app/api/v1/auth/me/route.ts`
- Create: `apps/web/src/app/login/page.tsx`
- Test: `apps/web/tests/routes.test.ts`

**Interfaces:**
- Consumes: `requestOtp`, `verifyOtp`, `createSession`, `resolveSession`, `revokeSession`, `driverFromEnv`, `systemClock`.
- Produces: four HTTP endpoints and a login screen.

Implements FR-13.1, FR-13.2 and FR-13.4.

- [ ] **Step 1: Write the failing test**

`apps/web/tests/routes.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { getAppDb } from '../src/db.js'
import { POST as requestRoute } from '../src/app/api/v1/auth/otp/request/route.js'
import { POST as verifyRoute } from '../src/app/api/v1/auth/otp/verify/route.js'
import { GET as meRoute } from '../src/app/api/v1/auth/me/route.js'

const db = getAppDb()
const PHONE = '+971501234567'

function post(url: string, body: unknown, cookie?: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
}

/** The console driver prints the code; capture it the way a developer would read it. */
function captureCode(fn: () => Promise<unknown>): Promise<string> {
  const lines: string[] = []
  const original = console.info
  console.info = (...args: unknown[]) => { lines.push(args.join(' ')) }
  return fn().then(() => {
    console.info = original
    const match = lines.join('\n').match(/(\d{6})/)
    if (!match) throw new Error(`no code found in console output:\n${lines.join('\n')}`)
    return match[1]!
  }).catch((e) => { console.info = original; throw e })
}

describe('auth routes', () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE sessions, phone_otps, customers, users RESTART IDENTITY CASCADE`)
  })

  it('requests an OTP and returns 200 without leaking the code', async () => {
    let body: unknown
    const code = await captureCode(async () => {
      const res = await requestRoute(post('http://localhost/api/v1/auth/otp/request', { phone: PHONE }))
      expect(res.status).toBe(200)
      body = await res.json()
    })
    expect(JSON.stringify(body)).not.toContain(code)
  })

  it('rejects a malformed phone with 400', async () => {
    const res = await requestRoute(post('http://localhost/api/v1/auth/otp/request', { phone: 'nope' }))
    expect(res.status).toBe(400)
  })

  it('rejects a missing body with 400 rather than throwing', async () => {
    const res = await requestRoute(post('http://localhost/api/v1/auth/otp/request', {}))
    expect(res.status).toBe(400)
  })

  it('verifies the code, creates the account on first sign-in, and sets a cookie', async () => {
    const code = await captureCode(() =>
      requestRoute(post('http://localhost/api/v1/auth/otp/request', { phone: PHONE })))
    const res = await verifyRoute(post('http://localhost/api/v1/auth/otp/verify', { phone: PHONE, code }))
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('aa_session=')
    expect(setCookie.toLowerCase()).toContain('httponly')
    // FR-13.4 — guest checkout creates a claimable account.
    const rows = await db.execute<{ count: string }>(sql`SELECT count(*) FROM users WHERE phone=${PHONE}`)
    expect(Number(rows.rows[0]!.count)).toBe(1)
  })

  it('signs an existing customer in without creating a second account', async () => {
    for (const _ of [1, 2]) {
      const code = await captureCode(() =>
        requestRoute(post('http://localhost/api/v1/auth/otp/request', { phone: PHONE })))
      const res = await verifyRoute(post('http://localhost/api/v1/auth/otp/verify', { phone: PHONE, code }))
      expect(res.status).toBe(200)
      // Clear the cooldown so the second request is permitted.
      await db.execute(sql`UPDATE phone_otps SET created_at = created_at - interval '2 minutes'`)
    }
    const rows = await db.execute<{ count: string }>(sql`SELECT count(*) FROM users WHERE phone=${PHONE}`)
    expect(Number(rows.rows[0]!.count)).toBe(1)
  })

  it('refuses a wrong code with 401', async () => {
    await captureCode(() => requestRoute(post('http://localhost/api/v1/auth/otp/request', { phone: PHONE })))
    const res = await verifyRoute(post('http://localhost/api/v1/auth/otp/verify',
      { phone: PHONE, code: '000000' }))
    expect(res.status).toBe(401)
  })

  it('returns 401 from /me without a session', async () => {
    const res = await meRoute(new Request('http://localhost/api/v1/auth/me'))
    expect(res.status).toBe(401)
  })

  it('returns the signed-in user from /me', async () => {
    const code = await captureCode(() =>
      requestRoute(post('http://localhost/api/v1/auth/otp/request', { phone: PHONE })))
    const verify = await verifyRoute(post('http://localhost/api/v1/auth/otp/verify', { phone: PHONE, code }))
    const cookie = (verify.headers.get('set-cookie') ?? '').split(';')[0]!
    const res = await meRoute(new Request('http://localhost/api/v1/auth/me', { headers: { cookie } }))
    expect(res.status).toBe(200)
    const body = await res.json() as { role: string; phone: string }
    expect(body.role).toBe('customer')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aa/web test tests/routes.test.ts`
Expected: FAIL — cannot resolve the route modules.

- [ ] **Step 3: Write minimal implementation**

`apps/web/src/app/api/v1/auth/otp/request/route.ts`:

```typescript
import { z } from 'zod'
import { getAppDb } from '@/db'
import { systemClock } from '@/auth/clock'
import { driverFromEnv } from '@/auth/notify'
import { requestOtp } from '@/auth/otp'

const Body = z.object({ phone: z.string().min(1) })

export async function POST(request: Request): Promise<Response> {
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'phone is required' }, { status: 400 })
  }

  const result = await requestOtp(
    { db: getAppDb(), notify: driverFromEnv(process.env.NOTIFY_DRIVER), clock: systemClock },
    { phone: parsed.data.phone, ipAddress: request.headers.get('x-forwarded-for') ?? undefined },
  )

  if (!result.ok) {
    const status = result.reason === 'cooldown' ? 429 : 400
    return Response.json({ error: result.reason }, { status })
  }
  // Deliberately no code in the response.
  return Response.json({ sent: true })
}
```

`apps/web/src/app/api/v1/auth/otp/verify/route.ts`:

```typescript
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { users, customers } from '@aa/db/src/schema/index.js'
import { getAppDb } from '@/db'
import { systemClock } from '@/auth/clock'
import { verifyOtp } from '@/auth/otp'
import { createSession, SESSION_COOKIE, sessionCookieOptions } from '@/auth/session'

const Body = z.object({ phone: z.string().min(1), code: z.string().length(6) })

export async function POST(request: Request): Promise<Response> {
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'phone and code are required' }, { status: 400 })

  const db = getAppDb()
  const result = await verifyOtp({ db, clock: systemClock }, parsed.data)
  if (!result.ok) {
    const status = result.reason === 'too_many_attempts' ? 429 : 401
    return Response.json({ error: result.reason }, { status })
  }

  // FR-13.4 — first sign-in creates a claimable customer account.
  let [user] = await db.select().from(users).where(eq(users.phone, parsed.data.phone)).limit(1)
  if (user === undefined) {
    ;[user] = await db.insert(users)
      .values({ phone: parsed.data.phone, fullName: '', role: 'customer' }).returning()
    await db.insert(customers).values({ userId: user!.id }).onConflictDoNothing()
  }

  const { token, expiresAt } = await createSession(
    { db, clock: systemClock },
    { userId: user!.id, role: user!.role as 'customer',
      ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
      userAgent: request.headers.get('user-agent') ?? undefined },
  )

  const opts = sessionCookieOptions(expiresAt)
  const cookie =
    `${SESSION_COOKIE}=${token}; Path=${opts.path}; Expires=${opts.expires.toUTCString()}; ` +
    `HttpOnly; SameSite=Lax${opts.secure ? '; Secure' : ''}`

  return Response.json({ ok: true }, { status: 200, headers: { 'set-cookie': cookie } })
}
```

`apps/web/src/app/api/v1/auth/me/route.ts`:

```typescript
import { eq } from 'drizzle-orm'
import { users } from '@aa/db/src/schema/index.js'
import { getAppDb } from '@/db'
import { systemClock } from '@/auth/clock'
import { resolveSession, SESSION_COOKIE } from '@/auth/session'

function readCookie(header: string | null, name: string): string | null {
  if (header === null) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

export async function GET(request: Request): Promise<Response> {
  const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE)
  if (token === null) return Response.json({ error: 'not signed in' }, { status: 401 })

  const db = getAppDb()
  const session = await resolveSession({ db, clock: systemClock }, token)
  if (session === null) return Response.json({ error: 'not signed in' }, { status: 401 })

  const [u] = await db.select({ phone: users.phone }).from(users)
    .where(eq(users.id, session.userId)).limit(1)

  return Response.json({
    userId: session.userId, role: session.role,
    fullName: session.fullName, branchId: session.branchId,
    phone: u?.phone ?? null,
  })
}
```

`apps/web/src/app/api/v1/auth/logout/route.ts`:

```typescript
import { getAppDb } from '@/db'
import { systemClock } from '@/auth/clock'
import { revokeSession, SESSION_COOKIE } from '@/auth/session'

export async function POST(request: Request): Promise<Response> {
  const header = request.headers.get('cookie')
  const token = header
    ?.split(';').map((p) => p.trim().split('='))
    .find(([k]) => k === SESSION_COOKIE)?.[1] ?? null

  if (token !== null) {
    await revokeSession({ db: getAppDb(), clock: systemClock }, token)
  }
  return Response.json({ ok: true }, {
    status: 200,
    headers: { 'set-cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` },
  })
}
```

`apps/web/src/app/login/page.tsx` — a client component, deliberately plain. Visual design is P1.4's work:

```tsx
'use client'

import { useState } from 'react'

export default function LoginPage() {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'phone' | 'code'>('phone')
  const [message, setMessage] = useState<string | null>(null)

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    const res = await fetch('/api/v1/auth/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone }),
    })
    if (res.ok) { setStage('code'); setMessage('Code sent. Check your messages.') }
    else setMessage((await res.json()).error ?? 'Could not send a code.')
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    const res = await fetch('/api/v1/auth/otp/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone, code }),
    })
    if (res.ok) window.location.href = '/'
    else setMessage((await res.json()).error ?? 'That code was not accepted.')
  }

  return (
    <main style={{ maxWidth: '24rem', marginInline: 'auto', padding: '2rem' }}>
      <h1>Sign in</h1>
      {stage === 'phone' ? (
        <form onSubmit={sendCode}>
          <label htmlFor="phone">Mobile number</label>
          <input id="phone" name="phone" type="tel" required
                 placeholder="+971 50 123 4567" value={phone}
                 onChange={(e) => setPhone(e.target.value)}
                 style={{ display: 'block', inlineSize: '100%', marginBlock: '0.5rem 1rem' }} />
          <button type="submit">Send code</button>
        </form>
      ) : (
        <form onSubmit={signIn}>
          <label htmlFor="code">Six-digit code</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code"
                 required maxLength={6} value={code}
                 onChange={(e) => setCode(e.target.value)}
                 style={{ display: 'block', inlineSize: '100%', marginBlock: '0.5rem 1rem' }} />
          <button type="submit">Sign in</button>
        </form>
      )}
      {message !== null && <p role="status">{message}</p>}
    </main>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aa/web test tests/routes.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app apps/web/tests/routes.test.ts
git commit -m "feat(web): add OTP auth routes and the login page"
```

---

### Task 8: Role guards and the PDPL export path

**Files:**
- Create: `apps/web/src/auth/guard.ts`
- Create: `apps/web/src/auth/pdpl.ts`
- Test: `apps/web/tests/guard.test.ts`, `apps/web/tests/pdpl.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `resolveSession`, the `users`, `customers`, `sessions` and `auditLog` tables.
- Produces:
  - `requireUser(deps, request): Promise<SessionUser>` — throws `AuthError` with a status
  - `requireRole(deps, request, roles): Promise<SessionUser>`
  - `exportPersonalData(deps, userId): Promise<PersonalDataExport>`
  - `anonymiseUser(deps, input): Promise<void>`

Implements FR-11.1, FR-11.3 and FR-13.8.

- [ ] **Step 1: Write the failing test**

`apps/web/tests/guard.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { getAppDb } from '../src/db.js'
import { users } from '@aa/db/src/schema/index.js'
import { createSession, SESSION_COOKIE } from '../src/auth/session.js'
import { requireUser, requireRole, AuthError } from '../src/auth/guard.js'
import type { Clock } from '../src/auth/clock.js'

const db = getAppDb()
const clock: Clock = () => new Date('2026-08-01T10:00:00Z')

async function signedInAs(role: 'customer' | 'staff' | 'owner', phone: string) {
  const [u] = await db.insert(users).values({ phone, fullName: 'T', role }).returning()
  const { token } = await createSession({ db, clock }, { userId: u!.id, role })
  return new Request('http://localhost/x', { headers: { cookie: `${SESSION_COOKIE}=${token}` } })
}

describe('role guards', () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE sessions, customers, users RESTART IDENTITY CASCADE`)
  })

  it('rejects an anonymous request with 401', async () => {
    await expect(requireUser({ db, clock }, new Request('http://localhost/x')))
      .rejects.toMatchObject({ status: 401 })
  })

  it('accepts a signed-in user', async () => {
    const req = await signedInAs('customer', '+971501111111')
    const u = await requireUser({ db, clock }, req)
    expect(u.role).toBe('customer')
  })

  it('rejects a role that is not permitted with 403, not 401', async () => {
    const req = await signedInAs('customer', '+971502222222')
    await expect(requireRole({ db, clock }, req, ['staff', 'owner']))
      .rejects.toMatchObject({ status: 403 })
  })

  it('accepts a permitted role', async () => {
    const req = await signedInAs('staff', '+971503333333')
    const u = await requireRole({ db, clock }, req, ['staff', 'owner'])
    expect(u.role).toBe('staff')
  })

  it('distinguishes not-signed-in from not-allowed', async () => {
    const anon = requireRole({ db, clock }, new Request('http://localhost/x'), ['owner'])
    await expect(anon).rejects.toBeInstanceOf(AuthError)
    await expect(anon).rejects.toMatchObject({ status: 401 })
  })
})
```

`apps/web/tests/pdpl.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { sql, eq } from 'drizzle-orm'
import { getAppDb } from '../src/db.js'
import { users, customers, auditLog } from '@aa/db/src/schema/index.js'
import { exportPersonalData, anonymiseUser } from '../src/auth/pdpl.js'
import type { Clock } from '../src/auth/clock.js'

const db = getAppDb()
const clock: Clock = () => new Date('2026-08-01T10:00:00Z')

async function aCustomer(phone: string) {
  const [u] = await db.insert(users)
    .values({ phone, email: `${phone}@example.com`, fullName: 'Aisha Khan', role: 'customer' })
    .returning()
  await db.insert(customers).values({ userId: u!.id, nationality: 'AE' })
  return u!
}

describe('PDPL export and anonymise (FR-13.8)', () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE audit_log, sessions, customers, users RESTART IDENTITY CASCADE`)
  })

  it('exports every personal field held about the customer', async () => {
    const u = await aCustomer('+971501111111')
    const data = await exportPersonalData({ db, clock }, u.id)
    expect(data.user.phone).toBe('+971501111111')
    expect(data.user.fullName).toBe('Aisha Khan')
    expect(data.customer?.nationality).toBe('AE')
  })

  it('anonymises rather than deleting, so financial records survive', async () => {
    const u = await aCustomer('+971502222222')
    await anonymiseUser({ db, clock }, { userId: u.id, actorUserId: u.id })

    const [after] = await db.select().from(users).where(eq(users.id, u.id))
    // The row must still exist — invoices and contracts reference it.
    expect(after).toBeDefined()
    expect(after!.fullName).not.toBe('Aisha Khan')
    expect(after!.email).toBeNull()
    expect(after!.phone).not.toBe('+971502222222')
    expect(after!.isActive).toBe(false)
  })

  it('writes an audit entry naming the actor (FR-11.3)', async () => {
    const u = await aCustomer('+971503333333')
    await anonymiseUser({ db, clock }, { userId: u.id, actorUserId: u.id })
    const entries = await db.select().from(auditLog).where(eq(auditLog.entityId, u.id))
    expect(entries).toHaveLength(1)
    expect(entries[0]!.action).toBe('anonymise')
    expect(entries[0]!.actorUserId).toBe(u.id)
  })

  it('leaves no way to recover the original phone from the anonymised row', async () => {
    const u = await aCustomer('+971504444444')
    await anonymiseUser({ db, clock }, { userId: u.id, actorUserId: u.id })
    const [after] = await db.select().from(users).where(eq(users.id, u.id))
    expect(JSON.stringify(after)).not.toContain('+971504444444')
  })

  it('is idempotent — anonymising twice does not throw or double-audit differently', async () => {
    const u = await aCustomer('+971505555555')
    await anonymiseUser({ db, clock }, { userId: u.id, actorUserId: u.id })
    await expect(anonymiseUser({ db, clock }, { userId: u.id, actorUserId: u.id })).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aa/web test tests/guard.test.ts tests/pdpl.test.ts`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Write minimal implementation**

`apps/web/src/auth/guard.ts`:

```typescript
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '@aa/db/src/schema/index.js'
import type { Clock } from './clock.js'
import { resolveSession, SESSION_COOKIE, type SessionUser, type UserRole } from './session.js'

/**
 * 401 means "we do not know who you are"; 403 means "we do, and you may not".
 * Collapsing them tells an attacker whether an endpoint exists.
 */
export class AuthError extends Error {
  constructor(readonly status: 401 | 403, message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

interface GuardDeps {
  readonly db: NodePgDatabase<typeof schema>
  readonly clock: Clock
}

function readCookie(header: string | null, name: string): string | null {
  if (header === null) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

export async function requireUser(deps: GuardDeps, request: Request): Promise<SessionUser> {
  const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE)
  if (token === null) throw new AuthError(401, 'Not signed in')
  const session = await resolveSession(deps, token)
  if (session === null) throw new AuthError(401, 'Not signed in')
  return session
}

export async function requireRole(
  deps: GuardDeps, request: Request, roles: readonly UserRole[],
): Promise<SessionUser> {
  const user = await requireUser(deps, request)
  if (!roles.includes(user.role)) {
    throw new AuthError(403, `Requires one of: ${roles.join(', ')}`)
  }
  return user
}
```

`apps/web/src/auth/pdpl.ts`:

```typescript
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '@aa/db/src/schema/index.js'
import { users, customers, auditLog, sessions } from '@aa/db/src/schema/index.js'
import type { Clock } from './clock.js'

interface PdplDeps {
  readonly db: NodePgDatabase<typeof schema>
  readonly clock: Clock
}

export interface PersonalDataExport {
  readonly exportedAt: string
  readonly user: Record<string, unknown>
  readonly customer: Record<string, unknown> | null
}

/** FR-13.8 — a customer may obtain everything held about them. */
export async function exportPersonalData(
  deps: PdplDeps, userId: string,
): Promise<PersonalDataExport> {
  const [user] = await deps.db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (user === undefined) throw new Error(`No such user: ${userId}`)
  const [customer] = await deps.db.select().from(customers)
    .where(eq(customers.userId, userId)).limit(1)
  return {
    exportedAt: deps.clock().toISOString(),
    user: { ...user, passwordHash: undefined, totpSecret: undefined },
    customer: customer ?? null,
  }
}

/**
 * FR-13.8, NFR-12 — deletion anonymises rather than removes.
 *
 * Invoices, signed rental agreements and handover records reference this row and must
 * be retained for five years under UAE tax law, so the row survives with its
 * identifying fields replaced by values that cannot be reversed. Sessions are revoked
 * and the account deactivated.
 */
export async function anonymiseUser(
  deps: PdplDeps,
  input: { readonly userId: string; readonly actorUserId: string; readonly ipAddress?: string },
): Promise<void> {
  const [before] = await deps.db.select().from(users)
    .where(eq(users.id, input.userId)).limit(1)
  if (before === undefined) return

  const marker = randomUUID()
  const after = {
    phone: `anonymised-${marker}`,
    email: null,
    fullName: 'Anonymised',
    passwordHash: null,
    totpSecret: null,
    isActive: false,
  }

  await deps.db.update(users).set(after).where(eq(users.id, input.userId))
  await deps.db.delete(sessions).where(eq(sessions.userId, input.userId))
  await deps.db.update(customers)
    .set({ nationality: null, dateOfBirth: null, internalNotes: null })
    .where(eq(customers.userId, input.userId))

  await deps.db.insert(auditLog).values({
    actorUserId: input.actorUserId,
    entityType: 'users',
    entityId: input.userId,
    action: 'anonymise',
    before: { phone: before.phone, email: before.email, fullName: before.fullName },
    after: { phone: after.phone, email: after.email, fullName: after.fullName },
    ipAddress: input.ipAddress ?? null,
  })
}
```

Add a CI step to `.github/workflows/ci.yml`, after the existing shared-coverage step:

```yaml
      - name: Assert the web test suite actually ran
        run: |
          pnpm --filter @aa/web exec vitest run --reporter=json --outputFile=/tmp/web-tests.json
          COUNT=$(node -e "console.log(require('/tmp/web-tests.json').numTotalTests)")
          echo "web tests executed: $COUNT"
          if [ "$COUNT" -lt 40 ]; then
            echo "::error::Expected at least 40 web tests, got $COUNT."
            exit 1
          fi
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aa/web test`
Expected: PASS — all web tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/auth/guard.ts apps/web/src/auth/pdpl.ts apps/web/tests .github/workflows/ci.yml
git commit -m "feat(web): add role guards and the PDPL export and anonymise path"
```

---

## Definition of done

- [ ] `pnpm test` passes — root, `@aa/db`, `@aa/shared`, `@aa/web` — exit 0
- [ ] `pnpm typecheck` passes with zero errors and covers `apps/web`
- [ ] `pnpm --filter @aa/web dev` serves `/login`, and requesting a code prints a six-digit OTP to the console
- [ ] Signing in with that code sets an `aa_session` cookie and `/api/v1/auth/me` returns the user
- [ ] No auth function reads `Date.now()` internally — every one takes a `Clock`
- [ ] No test asserts on a mock; OTP tests use the recording driver and a real Postgres
- [ ] CI green

## What this plan deliberately excludes

- **No staff login UI.** `verifyTotp` and the guards exist; the staff sign-in screen is P1.7's admin shell.
- **No password reset.** FR-13.5 needs email delivery, which has no provider yet.
- **No account lockout enforcement.** FR-13.9's columns exist on `users`; wiring the counter belongs with the password login path, not OTP.
- **No middleware.** Route handlers call the guards directly. A `middleware.ts` becomes worthwhile when there are many protected routes — P1.4.
- **No visual design.** The login page is deliberately plain; P1.4 owns the look.
