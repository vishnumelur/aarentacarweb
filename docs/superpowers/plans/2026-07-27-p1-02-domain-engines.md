# P1.2 Domain Engines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/shared` — the availability engine, the pricing quote function, and the booking state machine — as pure functions with no database access, so the server, the website and the Expo app all compute identical answers.

**Architecture:** Every function in this package is pure: data in, data out, no I/O. Callers fetch rows from `@aa/db` and pass them in. That is what makes these testable exhaustively without a database, and what lets the mobile app run the same pricing logic offline. The package has no dependency on `@aa/db` beyond its exported *types*.

**Tech Stack:** TypeScript 5 (strict) · Zod · Vitest · `@vitest/coverage-v8`

## Global Constraints

- **Node 24 LTS.** TypeScript strict, `noUncheckedIndexedAccess`, **no `any` in shared packages** (NFR-9).
- **Money is integer minor units (fils).** 1 AED = 100 fils. Every monetary value is `number` holding an integer. **No floating-point arithmetic on currency, ever.** Any division rounds explicitly and the rounding rule is stated.
- **Discounts and multipliers are basis points** (integer). 1500 bps = 15%. 13000 bps = 1.3×.
- **VAT is 5%**, read from settings as `vat_bps: 500`. **Never hardcode it** — the quote function takes it as an input.
- **The quote's output must satisfy the database's `totals_consistent` CHECK:** `totalFils = subtotalFils - discountFils + vatFils`. A quote that cannot be persisted is a bug.
- **Rates are versioned** (FR-17.7): the engine resolves which rate card applied on a given date and never mutates one.
- **Overlapping seasonal rules resolve by explicit priority, highest wins** (FR-17.2).
- **Store UTC, render Asia/Dubai** (NFR-5). All functions take and return `Date` in UTC. Branch opening hours are wall-clock times in Asia/Dubai and must be compared in that zone.
- **Branch opening hours are a list of intervals per weekday** — Friday has two.
- **90%+ unit test coverage on these three engines** (NFR-9), enforced by a coverage threshold in CI.
- **Files stay focused**; past roughly 300 lines is a signal to split.
- Pure functions only. **No imports from `@aa/db`'s runtime**, no database client, no `fetch`, no clock reads — a function needing "now" takes it as a parameter.

## Context from P1.1

`packages/db` exists with eight schema modules and 18 migrations. Relevant to this plan:

- `bookingStatus` is a 17-value pg enum: `DRAFT, PENDING_PAYMENT, CONFIRMED, DOCS_VERIFIED, READY_FOR_PICKUP, OUT, RETURNED, CLOSING, COMPLETED, CANCELLED, NO_SHOW, EXPIRED, ASSIGNED, EN_ROUTE, ARRIVED, IN_TRIP, DROPPED`.
- `rateCards` carry `dailyRateFils`, `depositFils`, `includedKmPerDay`, `excessKmRateFils`, `validFrom`, `validTo`. A partial unique index permits at most one open-ended card per class.
- `weeklyTiers` carry `rateCardId`, `minDays`, `discountBps`.
- `seasonalRates` carry `classId`, `startsOn`, `endsOn`, `multiplierBps`, `priority`.
- `addons` carry `priceFils`, `priceModel` (`per_day` | `per_booking`), `stockLimit`.
- `promoCodes` carry `discountType` (`percent` | `fixed`), `discountValue`, `validFrom`, `validTo`, `applicableProducts` (text array, NULL = all), `minBookingValueFils`, `totalUsageCap`, `perCustomerCap`.
- **Migration `0017` added an `EXCLUDE USING gist` constraint** preventing two bookings in status `CONFIRMED`, `DOCS_VERIFIED`, `READY_FOR_PICKUP` or `OUT` overlapping on one vehicle. **That is a backstop, not the mechanism.** The availability engine is the primary guard. A booking this engine wrongly permits reaches the customer as a raw Postgres error rather than "no longer available", so overlap logic gets the heaviest testing in this plan.
- Carried-forward findings live in `docs/superpowers/plans/P1-01-FOLLOW-UPS.md`.

## File structure

```
packages/shared/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts              re-exports the public surface
│   ├── money.ts              fils arithmetic and VAT — the only place rounding happens
│   ├── state-machine.ts      canTransition over bookingStatus
│   ├── pricing/
│   │   ├── types.ts          QuoteInput, QuoteResult, and their Zod schemas
│   │   ├── rate-resolution.ts  which rate card and seasonal rule apply on a date
│   │   └── quote.ts          the quote function
│   └── availability/
│       ├── types.ts          AvailabilityInput, AvailabilityResult, UnavailableReason
│       ├── overlap.ts        date-range overlap and the active-status set
│       ├── opening-hours.ts  branch interval validation in Asia/Dubai
│       └── engine.ts         composes the above into isVehicleAvailable
└── tests/
    ├── money.test.ts
    ├── state-machine.test.ts
    ├── rate-resolution.test.ts
    ├── quote.test.ts
    ├── overlap.test.ts
    ├── opening-hours.test.ts
    └── engine.test.ts
```

Split by responsibility rather than layer: `overlap.ts` changes when booking-status semantics change, `opening-hours.ts` when trading hours do. They have no reason to change together.

---

### Task 1: Package scaffold and money arithmetic

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/money.ts`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/money.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `addVat(netFils: number, vatBps: number): number`
  - `applyBps(amountFils: number, bps: number): number`
  - `applyMultiplierBps(amountFils: number, multiplierBps: number): number`
  - `filsToAed(fils: number): string`
  - All later tasks perform every monetary calculation through these. Nothing else rounds.

Implements the Global Constraints on money and VAT.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/money.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { addVat, applyBps, applyMultiplierBps, filsToAed } from '../src/money.js'

describe('money arithmetic', () => {
  it('adds 5% VAT to a net amount', () => {
    expect(addVat(10000, 500)).toBe(500)
    expect(addVat(24000, 500)).toBe(1200)
  })

  it('rounds VAT half up to the nearest fil', () => {
    // 1234 fils at 5% = 61.7 fils
    expect(addVat(1234, 500)).toBe(62)
    // 1230 fils at 5% = 61.5 fils -> 62, not 61
    expect(addVat(1230, 500)).toBe(62)
  })

  it('never returns a fractional value', () => {
    for (const net of [1, 7, 13, 99, 333, 12345, 999999]) {
      expect(Number.isInteger(addVat(net, 500))).toBe(true)
    }
  })

  it('treats vatBps as an input, never assuming 5%', () => {
    expect(addVat(10000, 0)).toBe(0)
    expect(addVat(10000, 1000)).toBe(1000)
  })

  it('applies a basis-point discount', () => {
    // 15% of 84000 = 12600
    expect(applyBps(84000, 1500)).toBe(12600)
    expect(applyBps(84000, 0)).toBe(0)
    expect(applyBps(84000, 10000)).toBe(84000)
  })

  it('applies a basis-point multiplier', () => {
    // 1.3x of 10000 = 13000
    expect(applyMultiplierBps(10000, 13000)).toBe(13000)
    // 1.0x is identity
    expect(applyMultiplierBps(12345, 10000)).toBe(12345)
    // 1.8x of 999 = 1798.2 -> 1798
    expect(applyMultiplierBps(999, 18000)).toBe(1798)
  })

  it('rejects a non-integer input rather than silently rounding it', () => {
    expect(() => addVat(100.5, 500)).toThrow(/integer/)
    expect(() => applyBps(100.5, 500)).toThrow(/integer/)
    expect(() => applyMultiplierBps(100.5, 10000)).toThrow(/integer/)
  })

  it('rejects a negative amount', () => {
    expect(() => addVat(-1, 500)).toThrow(/negative/)
    expect(() => applyBps(-1, 500)).toThrow(/negative/)
  })

  it('formats fils as AED for display', () => {
    expect(filsToAed(12000)).toBe('120.00')
    expect(filsToAed(5)).toBe('0.05')
    expect(filsToAed(0)).toBe('0.00')
    expect(filsToAed(123456)).toBe('1234.56')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aa/shared test`
Expected: FAIL — `Cannot find module '../src/money.js'`

- [ ] **Step 3: Write minimal implementation**

`packages/shared/package.json`:

```json
{
  "name": "@aa/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "build": "tsc -p tsconfig.build.json"
  },
  "dependencies": {
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^2.1.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

`packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

`packages/shared/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts"]
}
```

`packages/shared/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
```

`packages/shared/src/money.ts`:

```typescript
/**
 * All currency in this system is an integer count of fils. 1 AED = 100 fils.
 * Every rounding decision lives in this file and nowhere else — if a monetary
 * calculation appears elsewhere, it is a bug.
 */

function assertAmount(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer number of fils, got ${value}`)
  }
  if (value < 0) {
    throw new Error(`${label} must not be negative, got ${value}`)
  }
}

function assertBps(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer number of basis points, got ${value}`)
  }
  if (value < 0) {
    throw new Error(`${label} must not be negative, got ${value}`)
  }
}

/** Rounds half away from zero. Inputs here are non-negative, so this is half-up. */
function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5)
}

/** VAT payable on a net amount. `vatBps` is always supplied — never assumed to be 500. */
export function addVat(netFils: number, vatBps: number): number {
  assertAmount(netFils, 'netFils')
  assertBps(vatBps, 'vatBps')
  return roundHalfUp((netFils * vatBps) / 10_000)
}

/** The portion of an amount represented by `bps`. 1500 bps of 84000 is 12600. */
export function applyBps(amountFils: number, bps: number): number {
  assertAmount(amountFils, 'amountFils')
  assertBps(bps, 'bps')
  return roundHalfUp((amountFils * bps) / 10_000)
}

/** Scales an amount by a multiplier. 13000 bps means 1.3x; 10000 bps is identity. */
export function applyMultiplierBps(amountFils: number, multiplierBps: number): number {
  assertAmount(amountFils, 'amountFils')
  assertBps(multiplierBps, 'multiplierBps')
  return roundHalfUp((amountFils * multiplierBps) / 10_000)
}

/** Display only. Never feed the result back into a calculation. */
export function filsToAed(fils: number): string {
  assertAmount(fils, 'fils')
  return (fils / 100).toFixed(2)
}
```

`packages/shared/src/index.ts`:

```typescript
export * from './money.js'
```

Then install:

```bash
pnpm install
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aa/shared test`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared pnpm-lock.yaml
git commit -m "feat(shared): add fils arithmetic with explicit rounding"
```

---

### Task 2: Booking state machine

**Files:**
- Create: `packages/shared/src/state-machine.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/state-machine.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `type BookingStatus` — a union of the 17 status strings
  - `BOOKING_STATUSES: readonly BookingStatus[]`
  - `canTransition(from: BookingStatus, to: BookingStatus): boolean`
  - `assertTransition(from: BookingStatus, to: BookingStatus): void` — throws with a readable message
  - `nextStates(from: BookingStatus): readonly BookingStatus[]`
  - `isTerminal(status: BookingStatus): boolean`

Implements FR-3.1 and spec §4's state machine.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/state-machine.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  BOOKING_STATUSES, canTransition, assertTransition, nextStates, isTerminal,
  type BookingStatus,
} from '../src/state-machine.js'

describe('booking state machine', () => {
  it('knows all 17 statuses from the database enum', () => {
    expect(BOOKING_STATUSES).toHaveLength(17)
    for (const s of ['DRAFT', 'PENDING_PAYMENT', 'CONFIRMED', 'DOCS_VERIFIED',
      'READY_FOR_PICKUP', 'OUT', 'RETURNED', 'CLOSING', 'COMPLETED',
      'CANCELLED', 'NO_SHOW', 'EXPIRED',
      'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_TRIP', 'DROPPED']) {
      expect(BOOKING_STATUSES).toContain(s)
    }
  })

  it('walks the happy path end to end', () => {
    const path: BookingStatus[] = [
      'DRAFT', 'PENDING_PAYMENT', 'CONFIRMED', 'DOCS_VERIFIED',
      'READY_FOR_PICKUP', 'OUT', 'RETURNED', 'CLOSING', 'COMPLETED',
    ]
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!),
        `${path[i]} -> ${path[i + 1]} should be allowed`).toBe(true)
    }
  })

  it('refuses to skip verification before pickup', () => {
    expect(canTransition('CONFIRMED', 'READY_FOR_PICKUP')).toBe(false)
    expect(canTransition('CONFIRMED', 'OUT')).toBe(false)
  })

  it('refuses to move backwards', () => {
    expect(canTransition('OUT', 'CONFIRMED')).toBe(false)
    expect(canTransition('COMPLETED', 'OUT')).toBe(false)
    expect(canTransition('RETURNED', 'READY_FOR_PICKUP')).toBe(false)
  })

  it('allows cancellation only before the car goes out', () => {
    for (const s of ['DRAFT', 'PENDING_PAYMENT', 'CONFIRMED',
      'DOCS_VERIFIED', 'READY_FOR_PICKUP'] as BookingStatus[]) {
      expect(canTransition(s, 'CANCELLED'), `${s} -> CANCELLED`).toBe(true)
    }
    // Once the customer has the car, cancelling is meaningless — it must be returned.
    expect(canTransition('OUT', 'CANCELLED')).toBe(false)
    expect(canTransition('RETURNED', 'CANCELLED')).toBe(false)
  })

  it('expires only an unpaid booking (FR-3.3)', () => {
    expect(canTransition('PENDING_PAYMENT', 'EXPIRED')).toBe(true)
    expect(canTransition('DRAFT', 'EXPIRED')).toBe(true)
    expect(canTransition('CONFIRMED', 'EXPIRED')).toBe(false)
  })

  it('marks no-show only when the car was ready and never collected', () => {
    expect(canTransition('READY_FOR_PICKUP', 'NO_SHOW')).toBe(true)
    expect(canTransition('DOCS_VERIFIED', 'NO_SHOW')).toBe(true)
    expect(canTransition('DRAFT', 'NO_SHOW')).toBe(false)
    expect(canTransition('OUT', 'NO_SHOW')).toBe(false)
  })

  it('treats terminal states as terminal', () => {
    for (const s of ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED'] as BookingStatus[]) {
      expect(isTerminal(s), `${s} should be terminal`).toBe(true)
      expect(nextStates(s), `${s} should have no successors`).toHaveLength(0)
    }
    expect(isTerminal('OUT')).toBe(false)
  })

  it('never allows a transition to itself', () => {
    for (const s of BOOKING_STATUSES) {
      expect(canTransition(s, s), `${s} -> ${s}`).toBe(false)
    }
  })

  it('routes chauffeur bookings through the dispatch states', () => {
    expect(canTransition('DOCS_VERIFIED', 'ASSIGNED')).toBe(true)
    const trip: BookingStatus[] = ['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_TRIP', 'DROPPED']
    for (let i = 0; i < trip.length - 1; i++) {
      expect(canTransition(trip[i]!, trip[i + 1]!)).toBe(true)
    }
    expect(canTransition('DROPPED', 'CLOSING')).toBe(true)
  })

  it('throws a readable error naming both states', () => {
    expect(() => assertTransition('DRAFT', 'COMPLETED'))
      .toThrow(/DRAFT.*COMPLETED/)
  })

  it('has no unreachable state other than DRAFT', () => {
    const reachable = new Set<BookingStatus>(['DRAFT'])
    let grew = true
    while (grew) {
      grew = false
      for (const s of [...reachable]) {
        for (const n of nextStates(s)) {
          if (!reachable.has(n)) { reachable.add(n); grew = true }
        }
      }
    }
    for (const s of BOOKING_STATUSES) {
      expect(reachable.has(s), `${s} is unreachable from DRAFT`).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aa/shared test tests/state-machine.test.ts`
Expected: FAIL — `Cannot find module '../src/state-machine.js'`

- [ ] **Step 3: Write minimal implementation**

`packages/shared/src/state-machine.ts`:

```typescript
/**
 * The booking lifecycle from spec §4. This is the single definition — the server
 * enforces it, and the web and mobile clients read from it to decide which actions
 * to render. Duplicating this logic anywhere is how the three drift apart.
 *
 * The database's `booking_status` enum carries the same 17 values.
 */

export const BOOKING_STATUSES = [
  'DRAFT', 'PENDING_PAYMENT', 'CONFIRMED', 'DOCS_VERIFIED', 'READY_FOR_PICKUP',
  'OUT', 'RETURNED', 'CLOSING', 'COMPLETED',
  'CANCELLED', 'NO_SHOW', 'EXPIRED',
  'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_TRIP', 'DROPPED',
] as const

export type BookingStatus = (typeof BOOKING_STATUSES)[number]

/**
 * Allowed successors, keyed by current state. A state with an empty list is terminal.
 *
 * Cancellation is permitted up to and including READY_FOR_PICKUP. Once the vehicle is
 * OUT the booking can only be RETURNED — cancelling a rental the customer is currently
 * driving is not a thing.
 */
const TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  DRAFT: ['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED'],
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED', 'EXPIRED'],
  CONFIRMED: ['DOCS_VERIFIED', 'CANCELLED'],
  DOCS_VERIFIED: ['READY_FOR_PICKUP', 'ASSIGNED', 'CANCELLED', 'NO_SHOW'],
  READY_FOR_PICKUP: ['OUT', 'CANCELLED', 'NO_SHOW'],
  OUT: ['RETURNED'],
  RETURNED: ['CLOSING'],
  CLOSING: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
  EXPIRED: [],

  // Chauffeur dispatch (P2). Included now so the machine is complete and the enum
  // never needs altering later.
  ASSIGNED: ['EN_ROUTE', 'CANCELLED', 'NO_SHOW'],
  EN_ROUTE: ['ARRIVED'],
  ARRIVED: ['IN_TRIP', 'NO_SHOW'],
  IN_TRIP: ['DROPPED'],
  DROPPED: ['CLOSING'],
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function nextStates(from: BookingStatus): readonly BookingStatus[] {
  return TRANSITIONS[from]
}

export function isTerminal(status: BookingStatus): boolean {
  return TRANSITIONS[status].length === 0
}

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) {
    const allowed = TRANSITIONS[from]
    const suffix = allowed.length > 0 ? allowed.join(', ') : 'none — it is terminal'
    throw new Error(
      `Illegal booking transition ${from} -> ${to}. Allowed from ${from}: ${suffix}.`,
    )
  }
}
```

Add to `packages/shared/src/index.ts`:

```typescript
export * from './money.js'
export * from './state-machine.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aa/shared test tests/state-machine.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/state-machine.ts packages/shared/src/index.ts packages/shared/tests/state-machine.test.ts
git commit -m "feat(shared): add booking state machine as a pure function"
```

---

### Task 3: Rate card and seasonal rule resolution

**Files:**
- Create: `packages/shared/src/pricing/types.ts`
- Create: `packages/shared/src/pricing/rate-resolution.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/rate-resolution.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces:
  - `type RateCard = { id: string; classId: string; dailyRateFils: number; depositFils: number; includedKmPerDay: number; excessKmRateFils: number; validFrom: string; validTo: string | null }`
  - `type WeeklyTier = { rateCardId: string; minDays: number; discountBps: number }`
  - `type SeasonalRate = { classId: string; name: string; startsOn: string; endsOn: string; multiplierBps: number; priority: number }`
  - `resolveRateCard(cards: readonly RateCard[], onDate: string): RateCard | null`
  - `resolveSeasonalRate(rules: readonly SeasonalRate[], onDate: string): SeasonalRate | null`
  - `resolveWeeklyTier(tiers: readonly WeeklyTier[], days: number): WeeklyTier | null`

Dates are `YYYY-MM-DD` strings throughout, matching the database's `date` columns. Implements FR-17.2 and FR-17.7.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/rate-resolution.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  resolveRateCard, resolveSeasonalRate, resolveWeeklyTier,
  type RateCard, type SeasonalRate, type WeeklyTier,
} from '../src/pricing/rate-resolution.js'

const card = (id: string, validFrom: string, validTo: string | null): RateCard => ({
  id, classId: 'class-1', dailyRateFils: 12000, depositFils: 100000,
  includedKmPerDay: 250, excessKmRateFils: 50, validFrom, validTo,
})

describe('rate card resolution (FR-17.7)', () => {
  it('picks the open-ended current card', () => {
    const cards = [card('a', '2026-01-01', null)]
    expect(resolveRateCard(cards, '2026-08-01')?.id).toBe('a')
  })

  it('picks the historic card for a date inside its window', () => {
    const cards = [card('old', '2025-01-01', '2025-12-31'), card('new', '2026-01-01', null)]
    expect(resolveRateCard(cards, '2025-06-15')?.id).toBe('old')
    expect(resolveRateCard(cards, '2026-06-15')?.id).toBe('new')
  })

  it('treats both window boundaries as inclusive', () => {
    const cards = [card('old', '2025-01-01', '2025-12-31')]
    expect(resolveRateCard(cards, '2025-01-01')?.id).toBe('old')
    expect(resolveRateCard(cards, '2025-12-31')?.id).toBe('old')
    expect(resolveRateCard(cards, '2024-12-31')).toBeNull()
    expect(resolveRateCard(cards, '2026-01-01')).toBeNull()
  })

  it('returns null when no card covers the date rather than guessing', () => {
    expect(resolveRateCard([], '2026-08-01')).toBeNull()
    expect(resolveRateCard([card('a', '2027-01-01', null)], '2026-08-01')).toBeNull()
  })

  it('prefers the most recently effective card when windows overlap', () => {
    // The database permits historic overlaps; only one open-ended card is enforced.
    const cards = [card('older', '2026-01-01', '2026-12-31'), card('newer', '2026-06-01', '2026-12-31')]
    expect(resolveRateCard(cards, '2026-08-01')?.id).toBe('newer')
  })
})

describe('seasonal rule resolution (FR-17.2)', () => {
  const peak: SeasonalRate = {
    classId: 'class-1', name: 'Peak', startsOn: '2026-11-01', endsOn: '2027-03-31',
    multiplierBps: 13000, priority: 10,
  }
  const nye: SeasonalRate = {
    classId: 'class-1', name: 'NYE', startsOn: '2026-12-28', endsOn: '2027-01-02',
    multiplierBps: 18000, priority: 20,
  }

  it('applies the only rule covering the date', () => {
    expect(resolveSeasonalRate([peak, nye], '2026-11-15')?.name).toBe('Peak')
  })

  it('resolves an overlap by explicit priority, highest wins', () => {
    expect(resolveSeasonalRate([peak, nye], '2026-12-30')?.name).toBe('NYE')
    // Order of the input array must not matter.
    expect(resolveSeasonalRate([nye, peak], '2026-12-30')?.name).toBe('NYE')
  })

  it('returns null outside every window', () => {
    expect(resolveSeasonalRate([peak, nye], '2026-06-01')).toBeNull()
    expect(resolveSeasonalRate([], '2026-12-30')).toBeNull()
  })

  it('treats both boundaries as inclusive', () => {
    expect(resolveSeasonalRate([peak], '2026-11-01')?.name).toBe('Peak')
    expect(resolveSeasonalRate([peak], '2027-03-31')?.name).toBe('Peak')
    expect(resolveSeasonalRate([peak], '2027-04-01')).toBeNull()
  })
})

describe('weekly tier resolution (FR-2.2)', () => {
  const tiers: WeeklyTier[] = [
    { rateCardId: 'a', minDays: 7, discountBps: 1000 },
    { rateCardId: 'a', minDays: 14, discountBps: 1500 },
    { rateCardId: 'a', minDays: 30, discountBps: 2500 },
  ]

  it('applies no tier below the lowest threshold', () => {
    expect(resolveWeeklyTier(tiers, 1)).toBeNull()
    expect(resolveWeeklyTier(tiers, 6)).toBeNull()
  })

  it('applies a tier exactly at its threshold', () => {
    expect(resolveWeeklyTier(tiers, 7)?.discountBps).toBe(1000)
    expect(resolveWeeklyTier(tiers, 14)?.discountBps).toBe(1500)
  })

  it('applies the highest tier the duration qualifies for', () => {
    expect(resolveWeeklyTier(tiers, 13)?.discountBps).toBe(1000)
    expect(resolveWeeklyTier(tiers, 29)?.discountBps).toBe(1500)
    expect(resolveWeeklyTier(tiers, 60)?.discountBps).toBe(2500)
  })

  it('does not depend on input order', () => {
    const shuffled = [tiers[2]!, tiers[0]!, tiers[1]!]
    expect(resolveWeeklyTier(shuffled, 20)?.discountBps).toBe(1500)
  })

  it('returns null when there are no tiers', () => {
    expect(resolveWeeklyTier([], 30)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aa/shared test tests/rate-resolution.test.ts`
Expected: FAIL — `Cannot find module '../src/pricing/rate-resolution.js'`

- [ ] **Step 3: Write minimal implementation**

`packages/shared/src/pricing/rate-resolution.ts`:

```typescript
/**
 * Resolves which pricing rules applied on a given date.
 *
 * Dates are `YYYY-MM-DD` strings, matching the database's `date` columns. String
 * comparison is correct for that format and avoids timezone drift entirely — a
 * Date object would reintroduce the very ambiguity we are trying to avoid.
 */

export interface RateCard {
  readonly id: string
  readonly classId: string
  readonly dailyRateFils: number
  readonly depositFils: number
  readonly includedKmPerDay: number
  readonly excessKmRateFils: number
  readonly validFrom: string
  readonly validTo: string | null
}

export interface WeeklyTier {
  readonly rateCardId: string
  readonly minDays: number
  readonly discountBps: number
}

export interface SeasonalRate {
  readonly classId: string
  readonly name: string
  readonly startsOn: string
  readonly endsOn: string
  readonly multiplierBps: number
  readonly priority: number
}

/**
 * The rate card in force on `onDate`. Both window boundaries are inclusive, and a
 * null `validTo` means open-ended. Where windows overlap — which the database permits
 * for historic cards — the one that became effective most recently wins.
 *
 * Returns null rather than falling back to any card: a missing rate is a configuration
 * error the caller must surface, not paper over with the wrong price.
 */
export function resolveRateCard(
  cards: readonly RateCard[],
  onDate: string,
): RateCard | null {
  const applicable = cards.filter(
    (c) => c.validFrom <= onDate && (c.validTo === null || c.validTo >= onDate),
  )
  if (applicable.length === 0) return null
  return applicable.reduce((best, c) => (c.validFrom > best.validFrom ? c : best))
}

/**
 * The seasonal rule in force on `onDate`. FR-17.2: overlaps resolve by explicit
 * priority, highest wins — never by array order or creation time.
 */
export function resolveSeasonalRate(
  rules: readonly SeasonalRate[],
  onDate: string,
): SeasonalRate | null {
  const applicable = rules.filter((r) => r.startsOn <= onDate && r.endsOn >= onDate)
  if (applicable.length === 0) return null
  return applicable.reduce((best, r) => (r.priority > best.priority ? r : best))
}

/**
 * The most generous tier the duration qualifies for. `minDays` is inclusive, so a
 * 7-day rental gets the 7-day tier.
 */
export function resolveWeeklyTier(
  tiers: readonly WeeklyTier[],
  days: number,
): WeeklyTier | null {
  const applicable = tiers.filter((t) => days >= t.minDays)
  if (applicable.length === 0) return null
  return applicable.reduce((best, t) => (t.minDays > best.minDays ? t : best))
}
```

Add to `packages/shared/src/index.ts`:

```typescript
export * from './money.js'
export * from './state-machine.js'
export * from './pricing/rate-resolution.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aa/shared test tests/rate-resolution.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/pricing packages/shared/src/index.ts packages/shared/tests/rate-resolution.test.ts
git commit -m "feat(shared): resolve versioned rate cards, seasonal rules and weekly tiers"
```

---

### Task 4: The pricing quote function

**Files:**
- Create: `packages/shared/src/pricing/types.ts`
- Create: `packages/shared/src/pricing/quote.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/quote.test.ts`

**Interfaces:**
- Consumes: `addVat`, `applyBps`, `applyMultiplierBps` from Task 1; `RateCard`, `WeeklyTier`, `SeasonalRate`, `resolveRateCard`, `resolveSeasonalRate`, `resolveWeeklyTier` from Task 3.
- Produces:
  - `type QuoteInput`, `type QuoteResult`, `type QuoteLine`, `type Addon`, `type PromoCode`
  - `quote(input: QuoteInput): QuoteResult`
  - `QuoteInputSchema` — a Zod schema validating the input shape

Implements FR-2.1 through FR-2.7. **The result must satisfy the database's `totals_consistent` CHECK.**

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/quote.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { quote, type QuoteInput, type Addon, type PromoCode } from '../src/pricing/quote.js'
import type { RateCard, WeeklyTier, SeasonalRate } from '../src/pricing/rate-resolution.js'

const CARD: RateCard = {
  id: 'card-1', classId: 'economy', dailyRateFils: 12000, depositFils: 100000,
  includedKmPerDay: 250, excessKmRateFils: 50, validFrom: '2026-01-01', validTo: null,
}

const base = (over: Partial<QuoteInput> = {}): QuoteInput => ({
  product: 'self_drive',
  classId: 'economy',
  startDate: '2026-08-01',
  endDate: '2026-08-03',
  rateCards: [CARD],
  weeklyTiers: [],
  seasonalRates: [],
  addons: [],
  promoCode: null,
  deliveryFeeFils: 0,
  oneWayFeeFils: 0,
  vatBps: 500,
  ...over,
})

describe('pricing quote', () => {
  it('prices a two-day rental at the daily rate', () => {
    const r = quote(base())
    expect(r.days).toBe(2)
    expect(r.baseFils).toBe(24000)
    expect(r.subtotalFils).toBe(24000)
    expect(r.discountFils).toBe(0)
    expect(r.vatFils).toBe(1200)
    expect(r.totalFils).toBe(25200)
    expect(r.depositFils).toBe(100000)
  })

  it('always satisfies the database totals_consistent constraint', () => {
    const cases: QuoteInput[] = [
      base(),
      base({ endDate: '2026-08-10', weeklyTiers: [{ rateCardId: 'card-1', minDays: 7, discountBps: 1500 }] }),
      base({ deliveryFeeFils: 5000, oneWayFeeFils: 3000 }),
      base({ promoCode: { code: 'X', discountType: 'percent', discountValue: 10, applicableProducts: null, minBookingValueFils: 0 } }),
      base({ addons: [{ id: 'a', slug: 'gps', priceFils: 2000, priceModel: 'per_day', quantity: 1 }] }),
    ]
    for (const input of cases) {
      const r = quote(input)
      expect(r.totalFils, JSON.stringify(input)).toBe(r.subtotalFils - r.discountFils + r.vatFils)
      expect(Number.isInteger(r.totalFils)).toBe(true)
    }
  })

  it('counts days inclusively of the start and exclusively of the end', () => {
    // 1 Aug 08:00 to 3 Aug 08:00 is two rental days.
    expect(quote(base()).days).toBe(2)
    expect(quote(base({ endDate: '2026-08-02' })).days).toBe(1)
    expect(quote(base({ endDate: '2026-08-08' })).days).toBe(7)
  })

  it('charges a minimum of one day', () => {
    expect(quote(base({ endDate: '2026-08-01' })).days).toBe(1)
  })

  it('applies a weekly tier once the duration qualifies (FR-2.2)', () => {
    const tiers: WeeklyTier[] = [{ rateCardId: 'card-1', minDays: 7, discountBps: 1500 }]
    const r = quote(base({ endDate: '2026-08-08', weeklyTiers: tiers }))
    expect(r.days).toBe(7)
    expect(r.baseFils).toBe(84000)
    expect(r.discountFils).toBe(12600)       // 15% of 84000
    expect(r.vatFils).toBe(3570)             // 5% of (84000 - 12600)
    expect(r.totalFils).toBe(74970)
  })

  it('applies a seasonal multiplier to the base rate (FR-2.3)', () => {
    const seasonal: SeasonalRate[] = [{
      classId: 'economy', name: 'Peak', startsOn: '2026-11-01', endsOn: '2027-03-31',
      multiplierBps: 13000, priority: 10,
    }]
    const r = quote(base({ startDate: '2026-11-10', endDate: '2026-11-12', seasonalRates: seasonal }))
    expect(r.baseFils).toBe(31200)           // 24000 * 1.3
    expect(r.seasonalName).toBe('Peak')
  })

  it('prices per-day and per-booking addons differently', () => {
    const addons: Addon[] = [
      { id: 'a1', slug: 'child-seat', priceFils: 3000, priceModel: 'per_day', quantity: 2 },
      { id: 'a2', slug: 'extra-driver', priceFils: 5000, priceModel: 'per_booking', quantity: 1 },
    ]
    const r = quote(base({ addons }))
    // child seat: 3000 * 2 seats * 2 days = 12000; extra driver: 5000 once
    expect(r.addonsFils).toBe(17000)
    expect(r.subtotalFils).toBe(41000)
  })

  it('includes delivery and one-way fees in the subtotal', () => {
    const r = quote(base({ deliveryFeeFils: 5000, oneWayFeeFils: 3000 }))
    expect(r.subtotalFils).toBe(32000)
    expect(r.vatFils).toBe(1600)
  })

  it('applies a percentage promo to the discounted subtotal', () => {
    const promo: PromoCode = {
      code: 'WELCOME10', discountType: 'percent', discountValue: 10,
      applicableProducts: null, minBookingValueFils: 0,
    }
    const r = quote(base({ promoCode: promo }))
    expect(r.discountFils).toBe(2400)        // 10% of 24000
    expect(r.totalFils).toBe(22680)          // 24000 - 2400 + 1080
  })

  it('applies a fixed promo capped at the subtotal', () => {
    const promo: PromoCode = {
      code: 'FLAT', discountType: 'fixed', discountValue: 999999,
      applicableProducts: null, minBookingValueFils: 0,
    }
    const r = quote(base({ promoCode: promo }))
    expect(r.discountFils).toBe(24000)       // never more than the subtotal
    expect(r.totalFils).toBe(0)
    expect(r.vatFils).toBe(0)
  })

  it('ignores a promo below its minimum booking value (FR-2.6)', () => {
    const promo: PromoCode = {
      code: 'BIG', discountType: 'percent', discountValue: 10,
      applicableProducts: null, minBookingValueFils: 50000,
    }
    const r = quote(base({ promoCode: promo }))
    expect(r.discountFils).toBe(0)
    expect(r.promoRejectedReason).toBe('below_minimum_value')
  })

  it('ignores a promo scoped to other products (FR-17.4)', () => {
    const promo: PromoCode = {
      code: 'CHAUFFEUR', discountType: 'percent', discountValue: 20,
      applicableProducts: ['chauffeur_hourly'], minBookingValueFils: 0,
    }
    const r = quote(base({ promoCode: promo }))
    expect(r.discountFils).toBe(0)
    expect(r.promoRejectedReason).toBe('product_not_applicable')
  })

  it('never assumes 5% VAT — it uses what it is given', () => {
    expect(quote(base({ vatBps: 0 })).vatFils).toBe(0)
    expect(quote(base({ vatBps: 1000 })).vatFils).toBe(2400)
  })

  it('pins the rate card it used so the booking can record it (FR-17.7)', () => {
    expect(quote(base()).rateCardId).toBe('card-1')
  })

  it('throws when no rate card covers the start date rather than guessing', () => {
    expect(() => quote(base({ rateCards: [] }))).toThrow(/no rate card/i)
  })

  it('throws when the end date precedes the start date', () => {
    expect(() => quote(base({ startDate: '2026-08-10', endDate: '2026-08-01' })))
      .toThrow(/end date/i)
  })

  it('returns an itemised breakdown a customer could read', () => {
    const r = quote(base({
      addons: [{ id: 'a1', slug: 'gps', priceFils: 2000, priceModel: 'per_day', quantity: 1 }],
      deliveryFeeFils: 5000,
    }))
    const labels = r.lines.map((l) => l.label)
    expect(labels).toContain('Rental (2 days)')
    expect(labels).toContain('gps')
    expect(labels).toContain('Delivery')
    expect(labels).toContain('VAT')
    // Every line carries an integer amount.
    for (const l of r.lines) expect(Number.isInteger(l.amountFils)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aa/shared test tests/quote.test.ts`
Expected: FAIL — `Cannot find module '../src/pricing/quote.js'`

- [ ] **Step 3: Write minimal implementation**

`packages/shared/src/pricing/types.ts`:

```typescript
import { z } from 'zod'

export const BOOKING_PRODUCTS = [
  'self_drive', 'lease', 'chauffeur_hourly', 'chauffeur_transfer',
] as const
export type BookingProduct = (typeof BOOKING_PRODUCTS)[number]

export const AddonSchema = z.object({
  id: z.string(),
  slug: z.string(),
  priceFils: z.number().int().nonnegative(),
  priceModel: z.enum(['per_day', 'per_booking']),
  quantity: z.number().int().positive(),
})
export type Addon = z.infer<typeof AddonSchema>

export const PromoCodeSchema = z.object({
  code: z.string(),
  discountType: z.enum(['percent', 'fixed']),
  discountValue: z.number().int().positive(),
  /** NULL means every product. Values come from BOOKING_PRODUCTS. */
  applicableProducts: z.array(z.string()).nullable(),
  minBookingValueFils: z.number().int().nonnegative(),
})
export type PromoCode = z.infer<typeof PromoCodeSchema>

export type PromoRejectedReason =
  | 'below_minimum_value'
  | 'product_not_applicable'

export interface QuoteLine {
  readonly label: string
  readonly amountFils: number
}
```

`packages/shared/src/pricing/quote.ts`:

```typescript
import { addVat, applyBps, applyMultiplierBps } from '../money.js'
import {
  resolveRateCard, resolveSeasonalRate, resolveWeeklyTier,
  type RateCard, type SeasonalRate, type WeeklyTier,
} from './rate-resolution.js'
import type {
  Addon, BookingProduct, PromoCode, PromoRejectedReason, QuoteLine,
} from './types.js'

export type { Addon, PromoCode, QuoteLine } from './types.js'

export interface QuoteInput {
  readonly product: BookingProduct
  readonly classId: string
  /** `YYYY-MM-DD`, inclusive. */
  readonly startDate: string
  /** `YYYY-MM-DD`, exclusive — the day the car comes back. */
  readonly endDate: string
  readonly rateCards: readonly RateCard[]
  readonly weeklyTiers: readonly WeeklyTier[]
  readonly seasonalRates: readonly SeasonalRate[]
  readonly addons: readonly Addon[]
  readonly promoCode: PromoCode | null
  readonly deliveryFeeFils: number
  readonly oneWayFeeFils: number
  /** Read from settings. Never assumed. */
  readonly vatBps: number
}

export interface QuoteResult {
  readonly days: number
  readonly rateCardId: string
  readonly seasonalName: string | null
  readonly weeklyDiscountBps: number
  readonly baseFils: number
  readonly addonsFils: number
  readonly deliveryFeeFils: number
  readonly oneWayFeeFils: number
  readonly subtotalFils: number
  readonly discountFils: number
  readonly vatFils: number
  readonly totalFils: number
  readonly depositFils: number
  readonly includedKmTotal: number
  readonly excessKmRateFils: number
  readonly promoRejectedReason: PromoRejectedReason | null
  readonly lines: readonly QuoteLine[]
}

const MS_PER_DAY = 86_400_000

/** Whole days between two `YYYY-MM-DD` dates, minimum one. */
function rentalDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new Error(`Invalid date range: ${startDate} to ${endDate}`)
  }
  if (end < start) {
    throw new Error(`End date ${endDate} precedes start date ${startDate}`)
  }
  return Math.max(1, Math.round((end - start) / MS_PER_DAY))
}

/**
 * The single pricing calculation for the platform. Server, web and mobile all call
 * this, so a quote shown to a customer is the quote the server will charge.
 *
 * Order matters and is deliberate:
 *   base = daily rate x days, scaled by any seasonal multiplier
 *   subtotal = base + addons + delivery + one-way
 *   discount = weekly tier + promo, both applied to the subtotal, capped at it
 *   VAT = vatBps of (subtotal - discount)
 *   total = subtotal - discount + VAT
 *
 * That last line is exactly the database's `totals_consistent` CHECK. A quote that
 * cannot be persisted is a bug, so the shapes are kept identical on purpose.
 */
export function quote(input: QuoteInput): QuoteResult {
  const days = rentalDays(input.startDate, input.endDate)

  const card = resolveRateCard(input.rateCards, input.startDate)
  if (card === null) {
    throw new Error(
      `No rate card covers ${input.startDate} for class ${input.classId}. ` +
      `This is a configuration error — refusing to guess a price.`,
    )
  }

  const seasonal = resolveSeasonalRate(input.seasonalRates, input.startDate)
  const rawBase = card.dailyRateFils * days
  const baseFils = seasonal === null
    ? rawBase
    : applyMultiplierBps(rawBase, seasonal.multiplierBps)

  const addonsFils = input.addons.reduce((sum, a) => {
    const units = a.priceModel === 'per_day' ? a.quantity * days : a.quantity
    return sum + a.priceFils * units
  }, 0)

  const subtotalFils =
    baseFils + addonsFils + input.deliveryFeeFils + input.oneWayFeeFils

  const tier = resolveWeeklyTier(
    input.weeklyTiers.filter((t) => t.rateCardId === card.id),
    days,
  )
  const weeklyDiscountBps = tier?.discountBps ?? 0
  const weeklyDiscountFils = applyBps(subtotalFils, weeklyDiscountBps)

  let promoDiscountFils = 0
  let promoRejectedReason: PromoRejectedReason | null = null
  const promo = input.promoCode
  if (promo !== null) {
    if (promo.applicableProducts !== null &&
        !promo.applicableProducts.includes(input.product)) {
      promoRejectedReason = 'product_not_applicable'
    } else if (subtotalFils < promo.minBookingValueFils) {
      promoRejectedReason = 'below_minimum_value'
    } else {
      promoDiscountFils = promo.discountType === 'percent'
        ? applyBps(subtotalFils, promo.discountValue * 100)
        : promo.discountValue
    }
  }

  // A discount can never exceed what is being discounted — a negative total is not
  // a refund, it is a bug that would violate the database's non-negative CHECK.
  const discountFils = Math.min(subtotalFils, weeklyDiscountFils + promoDiscountFils)

  const netFils = subtotalFils - discountFils
  const vatFils = addVat(netFils, input.vatBps)
  const totalFils = netFils + vatFils

  const lines: QuoteLine[] = [{ label: `Rental (${days} days)`, amountFils: baseFils }]
  for (const a of input.addons) {
    const units = a.priceModel === 'per_day' ? a.quantity * days : a.quantity
    lines.push({ label: a.slug, amountFils: a.priceFils * units })
  }
  if (input.deliveryFeeFils > 0) {
    lines.push({ label: 'Delivery', amountFils: input.deliveryFeeFils })
  }
  if (input.oneWayFeeFils > 0) {
    lines.push({ label: 'One-way fee', amountFils: input.oneWayFeeFils })
  }
  if (weeklyDiscountFils > 0) {
    lines.push({ label: 'Long-rental discount', amountFils: -weeklyDiscountFils })
  }
  if (promoDiscountFils > 0) {
    lines.push({ label: `Promo ${promo?.code ?? ''}`.trim(), amountFils: -promoDiscountFils })
  }
  lines.push({ label: 'VAT', amountFils: vatFils })

  return {
    days,
    rateCardId: card.id,
    seasonalName: seasonal?.name ?? null,
    weeklyDiscountBps,
    baseFils,
    addonsFils,
    deliveryFeeFils: input.deliveryFeeFils,
    oneWayFeeFils: input.oneWayFeeFils,
    subtotalFils,
    discountFils,
    vatFils,
    totalFils,
    depositFils: card.depositFils,
    includedKmTotal: card.includedKmPerDay * days,
    excessKmRateFils: card.excessKmRateFils,
    promoRejectedReason,
    lines,
  }
}
```

Add to `packages/shared/src/index.ts`:

```typescript
export * from './money.js'
export * from './state-machine.js'
export * from './pricing/types.js'
export * from './pricing/rate-resolution.js'
export * from './pricing/quote.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aa/shared test tests/quote.test.ts`
Expected: PASS — 17 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/pricing packages/shared/src/index.ts packages/shared/tests/quote.test.ts
git commit -m "feat(shared): add the pricing quote function"
```

---

### Task 5: Booking overlap detection

**Files:**
- Create: `packages/shared/src/availability/overlap.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/overlap.test.ts`

**Interfaces:**
- Consumes: `BookingStatus` from Task 2.
- Produces:
  - `VEHICLE_HOLDING_STATUSES: readonly BookingStatus[]` — the four statuses in which a booking holds a vehicle
  - `holdsVehicle(status: BookingStatus): boolean`
  - `rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean`
  - `type ExistingBooking = { id: string; vehicleId: string | null; status: BookingStatus; startsAt: Date; endsAt: Date }`
  - `findConflictingBookings(bookings: readonly ExistingBooking[], vehicleId: string, startsAt: Date, endsAt: Date): readonly ExistingBooking[]`

**This is the highest-risk logic in the plan.** Migration `0017`'s exclusion constraint is a backstop; a booking this permits wrongly reaches the customer as a raw Postgres error. Implements FR-1.2 and FR-1.5.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/overlap.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  VEHICLE_HOLDING_STATUSES, holdsVehicle, rangesOverlap, findConflictingBookings,
  type ExistingBooking,
} from '../src/availability/overlap.js'
import { BOOKING_STATUSES, type BookingStatus } from '../src/state-machine.js'

const d = (iso: string) => new Date(iso)

const booking = (
  id: string, status: BookingStatus, startsAt: string, endsAt: string,
  vehicleId: string | null = 'v1',
): ExistingBooking => ({ id, vehicleId, status, startsAt: d(startsAt), endsAt: d(endsAt) })

describe('which statuses hold a vehicle', () => {
  it('matches migration 0017 exactly', () => {
    expect([...VEHICLE_HOLDING_STATUSES].sort()).toEqual(
      ['CONFIRMED', 'DOCS_VERIFIED', 'OUT', 'READY_FOR_PICKUP'],
    )
  })

  it('does not hold a vehicle before confirmation or after return', () => {
    for (const s of ['DRAFT', 'PENDING_PAYMENT', 'RETURNED', 'CLOSING',
      'COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED'] as BookingStatus[]) {
      expect(holdsVehicle(s), `${s} must not hold a vehicle`).toBe(false)
    }
  })

  it('classifies every status without throwing', () => {
    for (const s of BOOKING_STATUSES) expect(typeof holdsVehicle(s)).toBe('boolean')
  })
})

describe('range overlap', () => {
  it('detects a range fully inside another', () => {
    expect(rangesOverlap(
      d('2026-08-01T00:00:00Z'), d('2026-08-10T00:00:00Z'),
      d('2026-08-03T00:00:00Z'), d('2026-08-05T00:00:00Z'),
    )).toBe(true)
  })

  it('detects partial overlap at either end', () => {
    expect(rangesOverlap(
      d('2026-08-01T00:00:00Z'), d('2026-08-05T00:00:00Z'),
      d('2026-08-04T00:00:00Z'), d('2026-08-08T00:00:00Z'),
    )).toBe(true)
    expect(rangesOverlap(
      d('2026-08-04T00:00:00Z'), d('2026-08-08T00:00:00Z'),
      d('2026-08-01T00:00:00Z'), d('2026-08-05T00:00:00Z'),
    )).toBe(true)
  })

  it('treats touching ranges as NOT overlapping — one returns as the next collects', () => {
    expect(rangesOverlap(
      d('2026-08-01T00:00:00Z'), d('2026-08-05T00:00:00Z'),
      d('2026-08-05T00:00:00Z'), d('2026-08-08T00:00:00Z'),
    )).toBe(false)
  })

  it('detects a one-second overlap', () => {
    expect(rangesOverlap(
      d('2026-08-01T00:00:00Z'), d('2026-08-05T00:00:01Z'),
      d('2026-08-05T00:00:00Z'), d('2026-08-08T00:00:00Z'),
    )).toBe(true)
  })

  it('detects identical ranges', () => {
    expect(rangesOverlap(
      d('2026-08-01T00:00:00Z'), d('2026-08-05T00:00:00Z'),
      d('2026-08-01T00:00:00Z'), d('2026-08-05T00:00:00Z'),
    )).toBe(true)
  })

  it('is symmetric for every case', () => {
    const cases: Array<[string, string, string, string]> = [
      ['2026-08-01', '2026-08-05', '2026-08-03', '2026-08-09'],
      ['2026-08-01', '2026-08-05', '2026-08-05', '2026-08-09'],
      ['2026-08-01', '2026-08-05', '2026-08-06', '2026-08-09'],
      ['2026-08-01', '2026-08-31', '2026-08-10', '2026-08-11'],
    ]
    for (const [a1, a2, b1, b2] of cases) {
      const fwd = rangesOverlap(d(`${a1}T00:00:00Z`), d(`${a2}T00:00:00Z`), d(`${b1}T00:00:00Z`), d(`${b2}T00:00:00Z`))
      const rev = rangesOverlap(d(`${b1}T00:00:00Z`), d(`${b2}T00:00:00Z`), d(`${a1}T00:00:00Z`), d(`${a2}T00:00:00Z`))
      expect(fwd, `${a1}..${a2} vs ${b1}..${b2}`).toBe(rev)
    }
  })
})

describe('finding conflicting bookings', () => {
  it('finds an overlapping CONFIRMED booking on the same vehicle', () => {
    const existing = [booking('b1', 'CONFIRMED', '2026-08-01T00:00:00Z', '2026-08-05T00:00:00Z')]
    const found = findConflictingBookings(existing, 'v1', d('2026-08-03T00:00:00Z'), d('2026-08-07T00:00:00Z'))
    expect(found.map((b) => b.id)).toEqual(['b1'])
  })

  it('ignores a booking on a different vehicle', () => {
    const existing = [booking('b1', 'CONFIRMED', '2026-08-01T00:00:00Z', '2026-08-05T00:00:00Z', 'v2')]
    expect(findConflictingBookings(existing, 'v1', d('2026-08-03T00:00:00Z'), d('2026-08-07T00:00:00Z'))).toHaveLength(0)
  })

  it('ignores a booking with no vehicle assigned', () => {
    const existing = [booking('b1', 'CONFIRMED', '2026-08-01T00:00:00Z', '2026-08-05T00:00:00Z', null)]
    expect(findConflictingBookings(existing, 'v1', d('2026-08-03T00:00:00Z'), d('2026-08-07T00:00:00Z'))).toHaveLength(0)
  })

  it('ignores overlapping bookings in a status that does not hold the vehicle', () => {
    for (const s of ['DRAFT', 'PENDING_PAYMENT', 'CANCELLED', 'COMPLETED',
      'NO_SHOW', 'EXPIRED', 'RETURNED'] as BookingStatus[]) {
      const existing = [booking('b1', s, '2026-08-01T00:00:00Z', '2026-08-05T00:00:00Z')]
      expect(
        findConflictingBookings(existing, 'v1', d('2026-08-03T00:00:00Z'), d('2026-08-07T00:00:00Z')),
        `${s} should not conflict`,
      ).toHaveLength(0)
    }
  })

  it('conflicts on every status that does hold the vehicle', () => {
    for (const s of VEHICLE_HOLDING_STATUSES) {
      const existing = [booking('b1', s, '2026-08-01T00:00:00Z', '2026-08-05T00:00:00Z')]
      expect(
        findConflictingBookings(existing, 'v1', d('2026-08-03T00:00:00Z'), d('2026-08-07T00:00:00Z')),
        `${s} should conflict`,
      ).toHaveLength(1)
    }
  })

  it('permits a back-to-back booking starting exactly when the last ends', () => {
    const existing = [booking('b1', 'OUT', '2026-08-01T00:00:00Z', '2026-08-05T10:00:00Z')]
    expect(findConflictingBookings(existing, 'v1', d('2026-08-05T10:00:00Z'), d('2026-08-09T00:00:00Z'))).toHaveLength(0)
  })

  it('returns every conflict, not just the first', () => {
    const existing = [
      booking('b1', 'CONFIRMED', '2026-08-01T00:00:00Z', '2026-08-04T00:00:00Z'),
      booking('b2', 'OUT', '2026-08-06T00:00:00Z', '2026-08-09T00:00:00Z'),
      booking('b3', 'CANCELLED', '2026-08-02T00:00:00Z', '2026-08-08T00:00:00Z'),
    ]
    const found = findConflictingBookings(existing, 'v1', d('2026-08-03T00:00:00Z'), d('2026-08-07T00:00:00Z'))
    expect(found.map((b) => b.id).sort()).toEqual(['b1', 'b2'])
  })

  it('handles an empty booking list', () => {
    expect(findConflictingBookings([], 'v1', d('2026-08-01T00:00:00Z'), d('2026-08-05T00:00:00Z'))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aa/shared test tests/overlap.test.ts`
Expected: FAIL — `Cannot find module '../src/availability/overlap.js'`

- [ ] **Step 3: Write minimal implementation**

`packages/shared/src/availability/overlap.ts`:

```typescript
import type { BookingStatus } from '../state-machine.js'

/**
 * The statuses in which a booking is holding a physical vehicle.
 *
 * This list MUST stay identical to the status filter in migration `0017`'s
 * `bookings_no_vehicle_overlap` exclusion constraint. That constraint is the
 * database backstop; this is the primary guard. If they disagree, a booking this
 * engine permits gets rejected by Postgres and reaches the customer as a raw
 * database error instead of "no longer available".
 */
export const VEHICLE_HOLDING_STATUSES = [
  'CONFIRMED', 'DOCS_VERIFIED', 'READY_FOR_PICKUP', 'OUT',
] as const satisfies readonly BookingStatus[]

export function holdsVehicle(status: BookingStatus): boolean {
  return (VEHICLE_HOLDING_STATUSES as readonly BookingStatus[]).includes(status)
}

export interface ExistingBooking {
  readonly id: string
  readonly vehicleId: string | null
  readonly status: BookingStatus
  readonly startsAt: Date
  readonly endsAt: Date
}

/**
 * Half-open intervals: `[start, end)`. Two ranges that merely touch do NOT overlap,
 * so one customer returning at 10:00 and the next collecting at 10:00 is legal.
 * This matches Postgres `tstzrange(a, b)` default bounds, which the exclusion
 * constraint in migration `0017` relies on.
 */
export function rangesOverlap(
  aStart: Date, aEnd: Date, bStart: Date, bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime()
}

/**
 * Every existing booking that would collide with the proposed range on this vehicle.
 * Returns all of them rather than the first, so the caller can explain the conflict.
 */
export function findConflictingBookings(
  bookings: readonly ExistingBooking[],
  vehicleId: string,
  startsAt: Date,
  endsAt: Date,
): readonly ExistingBooking[] {
  return bookings.filter(
    (b) =>
      b.vehicleId === vehicleId &&
      holdsVehicle(b.status) &&
      rangesOverlap(b.startsAt, b.endsAt, startsAt, endsAt),
  )
}
```

Add to `packages/shared/src/index.ts`:

```typescript
export * from './availability/overlap.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aa/shared test tests/overlap.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/availability packages/shared/src/index.ts packages/shared/tests/overlap.test.ts
git commit -m "feat(shared): add booking overlap detection matching migration 0017"
```

---

### Task 6: Branch opening hours

**Files:**
- Create: `packages/shared/src/availability/opening-hours.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/opening-hours.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type OpeningInterval = { weekday: number; opensAt: string; closesAt: string }`
  - `isWithinOpeningHours(intervals: readonly OpeningInterval[], at: Date): boolean`
  - `dubaiWeekday(at: Date): number`
  - `dubaiTimeOfDay(at: Date): string`

Implements FR-18.2 and NFR-5's timezone rule. `weekday` is 0=Sunday..6=Saturday, matching Postgres DOW and the seed.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/opening-hours.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  isWithinOpeningHours, dubaiWeekday, dubaiTimeOfDay, type OpeningInterval,
} from '../src/availability/opening-hours.js'

// The real AA Rentals schedule: Sat-Thu 08:00-21:30, Fri 08:30-12:00 and 17:00-21:30.
const HOURS: OpeningInterval[] = [
  { weekday: 0, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 1, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 2, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 3, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 4, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 5, opensAt: '08:30', closesAt: '12:00' },
  { weekday: 5, opensAt: '17:00', closesAt: '21:30' },
  { weekday: 6, opensAt: '08:00', closesAt: '21:30' },
]

describe('Dubai timezone helpers', () => {
  it('converts UTC to the Dubai weekday', () => {
    // 2026-08-01 is a Saturday. 04:00Z is 08:00 in Dubai (UTC+4).
    expect(dubaiWeekday(new Date('2026-08-01T04:00:00Z'))).toBe(6)
  })

  it('rolls the weekday over when UTC and Dubai differ in date', () => {
    // 2026-08-01 21:00Z is 2026-08-02 01:00 in Dubai — Saturday becomes Sunday.
    expect(dubaiWeekday(new Date('2026-08-01T21:00:00Z'))).toBe(0)
  })

  it('renders the Dubai wall-clock time', () => {
    expect(dubaiTimeOfDay(new Date('2026-08-01T04:00:00Z'))).toBe('08:00')
    expect(dubaiTimeOfDay(new Date('2026-08-01T17:30:00Z'))).toBe('21:30')
    expect(dubaiTimeOfDay(new Date('2026-08-01T20:00:00Z'))).toBe('00:00')
  })
})

describe('opening hours', () => {
  it('accepts a time inside a weekday interval', () => {
    // Saturday 10:00 Dubai = 06:00Z
    expect(isWithinOpeningHours(HOURS, new Date('2026-08-01T06:00:00Z'))).toBe(true)
  })

  it('rejects a time before opening', () => {
    // Saturday 07:00 Dubai = 03:00Z
    expect(isWithinOpeningHours(HOURS, new Date('2026-08-01T03:00:00Z'))).toBe(false)
  })

  it('rejects a time after closing', () => {
    // Saturday 22:00 Dubai = 18:00Z
    expect(isWithinOpeningHours(HOURS, new Date('2026-08-01T18:00:00Z'))).toBe(false)
  })

  it('accepts both Friday intervals and rejects the gap between them', () => {
    // 2026-08-07 is a Friday.
    // 09:00 Dubai = 05:00Z — inside the morning interval
    expect(isWithinOpeningHours(HOURS, new Date('2026-08-07T05:00:00Z'))).toBe(true)
    // 14:00 Dubai = 10:00Z — the Friday prayer gap
    expect(isWithinOpeningHours(HOURS, new Date('2026-08-07T10:00:00Z'))).toBe(false)
    // 18:00 Dubai = 14:00Z — inside the evening interval
    expect(isWithinOpeningHours(HOURS, new Date('2026-08-07T14:00:00Z'))).toBe(true)
  })

  it('treats opening time as inclusive and closing time as exclusive', () => {
    // Saturday 08:00 Dubai = 04:00Z — exactly opening
    expect(isWithinOpeningHours(HOURS, new Date('2026-08-01T04:00:00Z'))).toBe(true)
    // Saturday 21:30 Dubai = 17:30Z — exactly closing
    expect(isWithinOpeningHours(HOURS, new Date('2026-08-01T17:30:00Z'))).toBe(false)
  })

  it('rejects everything when a branch has no hours for that day', () => {
    const closedFriday = HOURS.filter((h) => h.weekday !== 5)
    expect(isWithinOpeningHours(closedFriday, new Date('2026-08-07T05:00:00Z'))).toBe(false)
  })

  it('rejects everything when the interval list is empty', () => {
    expect(isWithinOpeningHours([], new Date('2026-08-01T06:00:00Z'))).toBe(false)
  })

  it('tolerates seconds in the stored time', () => {
    const withSeconds: OpeningInterval[] = [{ weekday: 6, opensAt: '08:00:00', closesAt: '21:30:00' }]
    expect(isWithinOpeningHours(withSeconds, new Date('2026-08-01T06:00:00Z'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aa/shared test tests/opening-hours.test.ts`
Expected: FAIL — `Cannot find module '../src/availability/opening-hours.js'`

- [ ] **Step 3: Write minimal implementation**

`packages/shared/src/availability/opening-hours.ts`:

```typescript
/**
 * Branch trading hours.
 *
 * NFR-5: timestamps are stored UTC and rendered Asia/Dubai. Opening hours are
 * wall-clock times in Dubai, so every comparison converts first. Dubai has no
 * daylight saving, but `Intl` is used rather than a fixed +4 offset so this stays
 * correct if that ever changes.
 *
 * `weekday` is 0=Sunday..6=Saturday, matching Postgres DOW and the seed data.
 * A weekday may have several intervals — Friday has two, either side of prayers.
 */

const DUBAI = 'Asia/Dubai'

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
}

export interface OpeningInterval {
  readonly weekday: number
  /** `HH:MM` or `HH:MM:SS`, Dubai wall-clock. */
  readonly opensAt: string
  readonly closesAt: string
}

export function dubaiWeekday(at: Date): number {
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone: DUBAI, weekday: 'short',
  }).format(at)
  const index = WEEKDAY_INDEX[short]
  if (index === undefined) throw new Error(`Unrecognised weekday: ${short}`)
  return index
}

export function dubaiTimeOfDay(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: DUBAI, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at)
}

/** `HH:MM` or `HH:MM:SS` to minutes since midnight, so comparison is numeric. */
function toMinutes(time: string): number {
  const parts = time.split(':')
  const hours = Number(parts[0])
  const minutes = Number(parts[1] ?? '0')
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    throw new Error(`Invalid time: ${time}`)
  }
  return hours * 60 + minutes
}

/**
 * Whether the branch is open at this instant. Opening is inclusive, closing is
 * exclusive — a branch closing at 21:30 is shut at 21:30, so no pickup slot is
 * offered for a moment nobody is there.
 */
export function isWithinOpeningHours(
  intervals: readonly OpeningInterval[],
  at: Date,
): boolean {
  const weekday = dubaiWeekday(at)
  const minutes = toMinutes(dubaiTimeOfDay(at))
  return intervals.some(
    (i) =>
      i.weekday === weekday &&
      minutes >= toMinutes(i.opensAt) &&
      minutes < toMinutes(i.closesAt),
  )
}
```

Add to `packages/shared/src/index.ts`:

```typescript
export * from './availability/opening-hours.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aa/shared test tests/opening-hours.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/availability/opening-hours.ts packages/shared/src/index.ts packages/shared/tests/opening-hours.test.ts
git commit -m "feat(shared): add Dubai-aware branch opening hours"
```

---

### Task 7: The availability engine

**Files:**
- Create: `packages/shared/src/availability/types.ts`
- Create: `packages/shared/src/availability/engine.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/engine.test.ts`

**Interfaces:**
- Consumes: `ExistingBooking`, `findConflictingBookings` from Task 5; `OpeningInterval`, `isWithinOpeningHours` from Task 6.
- Produces:
  - `type UnavailableReason` — a discriminated union explaining why
  - `type VehicleForAvailability`, `type MaintenanceBlock`, `type VehicleDocumentExpiry`
  - `type AvailabilityInput`, `type AvailabilityResult`
  - `checkAvailability(input: AvailabilityInput): AvailabilityResult`

Implements FR-1.2, FR-1.5, FR-7.2, FR-7.4, FR-18.2.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/engine.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { checkAvailability, type AvailabilityInput } from '../src/availability/engine.js'
import type { OpeningInterval } from '../src/availability/opening-hours.js'

const HOURS: OpeningInterval[] = [
  { weekday: 0, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 1, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 2, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 3, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 4, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 5, opensAt: '08:30', closesAt: '12:00' },
  { weekday: 5, opensAt: '17:00', closesAt: '21:30' },
  { weekday: 6, opensAt: '08:00', closesAt: '21:30' },
]

// Saturday 1 Aug 2026, 10:00 Dubai -> Monday 3 Aug, 10:00 Dubai
const START = new Date('2026-08-01T06:00:00Z')
const END = new Date('2026-08-03T06:00:00Z')

const base = (over: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  vehicle: { id: 'v1', status: 'available', branchId: 'b1' },
  startsAt: START,
  endsAt: END,
  existingBookings: [],
  maintenanceBlocks: [],
  documentExpiries: [],
  pickupBranchHours: HOURS,
  returnBranchHours: HOURS,
  ...over,
})

describe('availability engine', () => {
  it('says available when nothing blocks it', () => {
    const r = checkAvailability(base())
    expect(r.available).toBe(true)
    expect(r.reasons).toHaveLength(0)
  })

  it('blocks a vehicle already booked in an overlapping range (FR-1.2)', () => {
    const r = checkAvailability(base({
      existingBookings: [{
        id: 'b1', vehicleId: 'v1', status: 'CONFIRMED',
        startsAt: new Date('2026-08-02T06:00:00Z'),
        endsAt: new Date('2026-08-06T06:00:00Z'),
      }],
    }))
    expect(r.available).toBe(false)
    expect(r.reasons.map((x) => x.kind)).toContain('booked')
    const booked = r.reasons.find((x) => x.kind === 'booked')
    expect(booked?.kind === 'booked' && booked.conflictingBookingIds).toEqual(['b1'])
  })

  it('permits a back-to-back booking', () => {
    const r = checkAvailability(base({
      existingBookings: [{
        id: 'b1', vehicleId: 'v1', status: 'OUT',
        startsAt: new Date('2026-07-28T06:00:00Z'),
        endsAt: START,
      }],
    }))
    expect(r.available).toBe(true)
  })

  it('blocks a vehicle in the workshop (FR-7.4)', () => {
    const r = checkAvailability(base({
      maintenanceBlocks: [{ id: 'm1', startsOn: '2026-08-02', endsOn: '2026-08-04' }],
    }))
    expect(r.available).toBe(false)
    expect(r.reasons.map((x) => x.kind)).toContain('maintenance')
  })

  it('ignores a maintenance block that ended before the rental', () => {
    const r = checkAvailability(base({
      maintenanceBlocks: [{ id: 'm1', startsOn: '2026-07-01', endsOn: '2026-07-20' }],
    }))
    expect(r.available).toBe(true)
  })

  it('treats an open-ended maintenance block as blocking', () => {
    const r = checkAvailability(base({
      maintenanceBlocks: [{ id: 'm1', startsOn: '2026-07-01', endsOn: null }],
    }))
    expect(r.available).toBe(false)
  })

  it('blocks a vehicle whose mandatory document expires mid-rental (FR-7.2)', () => {
    const r = checkAvailability(base({
      documentExpiries: [{ type: 'insurance', expiresOn: '2026-08-02' }],
    }))
    expect(r.available).toBe(false)
    const reason = r.reasons.find((x) => x.kind === 'document_expired')
    expect(reason?.kind === 'document_expired' && reason.documentType).toBe('insurance')
  })

  it('allows a document expiring after the rental ends', () => {
    const r = checkAvailability(base({
      documentExpiries: [{ type: 'insurance', expiresOn: '2027-01-01' }],
    }))
    expect(r.available).toBe(true)
  })

  it('blocks a document that expires exactly on the return date', () => {
    // The car must be legal for the whole rental, including the day it comes back.
    const r = checkAvailability(base({
      documentExpiries: [{ type: 'mulkiya', expiresOn: '2026-08-03' }],
    }))
    expect(r.available).toBe(false)
  })

  it('blocks a retired or already-rented vehicle', () => {
    for (const status of ['retired', 'maintenance'] as const) {
      const r = checkAvailability(base({ vehicle: { id: 'v1', status, branchId: 'b1' } }))
      expect(r.available, status).toBe(false)
      expect(r.reasons.map((x) => x.kind)).toContain('vehicle_status')
    }
  })

  it('blocks a pickup outside branch opening hours (FR-18.2)', () => {
    // Saturday 23:00 Dubai = 19:00Z, after the 21:30 close
    const r = checkAvailability(base({ startsAt: new Date('2026-08-01T19:00:00Z') }))
    expect(r.available).toBe(false)
    expect(r.reasons.map((x) => x.kind)).toContain('pickup_outside_hours')
  })

  it('blocks a return during the Friday prayer gap', () => {
    // Friday 7 Aug, 14:00 Dubai = 10:00Z
    const r = checkAvailability(base({
      startsAt: new Date('2026-08-05T06:00:00Z'),
      endsAt: new Date('2026-08-07T10:00:00Z'),
    }))
    expect(r.available).toBe(false)
    expect(r.reasons.map((x) => x.kind)).toContain('return_outside_hours')
  })

  it('reports every reason, not just the first', () => {
    const r = checkAvailability(base({
      vehicle: { id: 'v1', status: 'retired', branchId: 'b1' },
      maintenanceBlocks: [{ id: 'm1', startsOn: '2026-08-01', endsOn: null }],
      documentExpiries: [{ type: 'insurance', expiresOn: '2026-08-02' }],
    }))
    expect(r.available).toBe(false)
    expect(r.reasons.length).toBeGreaterThanOrEqual(3)
  })

  it('rejects a range that ends before it starts', () => {
    expect(() => checkAvailability(base({ endsAt: new Date('2026-07-01T06:00:00Z') })))
      .toThrow(/before/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aa/shared test tests/engine.test.ts`
Expected: FAIL — `Cannot find module '../src/availability/engine.js'`

- [ ] **Step 3: Write minimal implementation**

`packages/shared/src/availability/types.ts`:

```typescript
import type { ExistingBooking } from './overlap.js'
import type { OpeningInterval } from './opening-hours.js'

export type VehicleStatus = 'available' | 'rented' | 'maintenance' | 'retired'

export interface VehicleForAvailability {
  readonly id: string
  readonly status: VehicleStatus
  readonly branchId: string
}

export interface MaintenanceBlock {
  readonly id: string
  /** `YYYY-MM-DD`. */
  readonly startsOn: string
  /** `YYYY-MM-DD`, or null for an open-ended job. */
  readonly endsOn: string | null
}

export interface VehicleDocumentExpiry {
  readonly type: string
  /** `YYYY-MM-DD`. */
  readonly expiresOn: string
}

export type UnavailableReason =
  | { readonly kind: 'vehicle_status'; readonly status: VehicleStatus }
  | { readonly kind: 'booked'; readonly conflictingBookingIds: readonly string[] }
  | { readonly kind: 'maintenance'; readonly blockIds: readonly string[] }
  | { readonly kind: 'document_expired'; readonly documentType: string; readonly expiresOn: string }
  | { readonly kind: 'pickup_outside_hours' }
  | { readonly kind: 'return_outside_hours' }

export interface AvailabilityInput {
  readonly vehicle: VehicleForAvailability
  readonly startsAt: Date
  readonly endsAt: Date
  readonly existingBookings: readonly ExistingBooking[]
  readonly maintenanceBlocks: readonly MaintenanceBlock[]
  readonly documentExpiries: readonly VehicleDocumentExpiry[]
  readonly pickupBranchHours: readonly OpeningInterval[]
  readonly returnBranchHours: readonly OpeningInterval[]
}

export interface AvailabilityResult {
  readonly available: boolean
  readonly reasons: readonly UnavailableReason[]
}
```

`packages/shared/src/availability/engine.ts`:

```typescript
import { findConflictingBookings } from './overlap.js'
import { isWithinOpeningHours } from './opening-hours.js'
import type {
  AvailabilityInput, AvailabilityResult, UnavailableReason,
} from './types.js'

export type {
  AvailabilityInput, AvailabilityResult, UnavailableReason,
  VehicleForAvailability, MaintenanceBlock, VehicleDocumentExpiry, VehicleStatus,
} from './types.js'

/** `YYYY-MM-DD` of a UTC instant. Used to compare against date-typed columns. */
function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10)
}

/**
 * Whether a vehicle can be booked for a range, and if not, every reason why.
 *
 * All reasons are collected rather than short-circuiting, so staff see the full
 * picture — a car can be both in the workshop and out of insurance, and fixing
 * only the first still leaves it unbookable.
 *
 * This is the PRIMARY guard against double-booking. Migration `0017`'s exclusion
 * constraint is a backstop: anything this permits but the database rejects reaches
 * the customer as a raw Postgres error rather than a graceful message.
 */
export function checkAvailability(input: AvailabilityInput): AvailabilityResult {
  if (input.endsAt.getTime() < input.startsAt.getTime()) {
    throw new Error(
      `Return ${input.endsAt.toISOString()} is before pickup ${input.startsAt.toISOString()}`,
    )
  }

  const reasons: UnavailableReason[] = []

  if (input.vehicle.status !== 'available') {
    reasons.push({ kind: 'vehicle_status', status: input.vehicle.status })
  }

  const conflicts = findConflictingBookings(
    input.existingBookings, input.vehicle.id, input.startsAt, input.endsAt,
  )
  if (conflicts.length > 0) {
    reasons.push({ kind: 'booked', conflictingBookingIds: conflicts.map((b) => b.id) })
  }

  const startDate = isoDate(input.startsAt)
  const endDate = isoDate(input.endsAt)

  const blocking = input.maintenanceBlocks.filter(
    (m) => m.startsOn <= endDate && (m.endsOn === null || m.endsOn >= startDate),
  )
  if (blocking.length > 0) {
    reasons.push({ kind: 'maintenance', blockIds: blocking.map((m) => m.id) })
  }

  // The vehicle must be legal for the whole rental, including the return day.
  for (const doc of input.documentExpiries) {
    if (doc.expiresOn <= endDate) {
      reasons.push({
        kind: 'document_expired', documentType: doc.type, expiresOn: doc.expiresOn,
      })
    }
  }

  if (!isWithinOpeningHours(input.pickupBranchHours, input.startsAt)) {
    reasons.push({ kind: 'pickup_outside_hours' })
  }
  if (!isWithinOpeningHours(input.returnBranchHours, input.endsAt)) {
    reasons.push({ kind: 'return_outside_hours' })
  }

  return { available: reasons.length === 0, reasons }
}
```

Add to `packages/shared/src/index.ts`:

```typescript
export * from './availability/types.js'
export * from './availability/engine.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aa/shared test tests/engine.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/availability packages/shared/src/index.ts packages/shared/tests/engine.test.ts
git commit -m "feat(shared): add the availability engine"
```

---

### Task 8: Coverage gate and cross-engine integration

**Files:**
- Modify: `packages/shared/vitest.config.ts`
- Modify: `packages/shared/package.json`
- Modify: `.github/workflows/ci.yml`
- Test: `packages/shared/tests/integration.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-7.
- Produces: a `test:coverage` script and a CI gate enforcing NFR-9's 90% threshold on the three engines.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/integration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { quote } from '../src/pricing/quote.js'
import { checkAvailability } from '../src/availability/engine.js'
import { canTransition } from '../src/state-machine.js'
import type { RateCard } from '../src/pricing/rate-resolution.js'
import type { OpeningInterval } from '../src/availability/opening-hours.js'

const CARD: RateCard = {
  id: 'card-1', classId: 'economy', dailyRateFils: 12000, depositFils: 100000,
  includedKmPerDay: 250, excessKmRateFils: 50, validFrom: '2026-01-01', validTo: null,
}
const HOURS: OpeningInterval[] = [
  { weekday: 6, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 1, opensAt: '08:00', closesAt: '21:30' },
]

describe('the three engines compose into a bookable quote', () => {
  it('quotes a vehicle that availability confirms is free', () => {
    const startsAt = new Date('2026-08-01T06:00:00Z')   // Sat 10:00 Dubai
    const endsAt = new Date('2026-08-03T06:00:00Z')     // Mon 10:00 Dubai

    const availability = checkAvailability({
      vehicle: { id: 'v1', status: 'available', branchId: 'b1' },
      startsAt, endsAt,
      existingBookings: [], maintenanceBlocks: [], documentExpiries: [],
      pickupBranchHours: HOURS, returnBranchHours: HOURS,
    })
    expect(availability.available).toBe(true)

    const q = quote({
      product: 'self_drive', classId: 'economy',
      startDate: '2026-08-01', endDate: '2026-08-03',
      rateCards: [CARD], weeklyTiers: [], seasonalRates: [], addons: [],
      promoCode: null, deliveryFeeFils: 0, oneWayFeeFils: 0, vatBps: 500,
    })

    // The quote's shape is exactly what the bookings table will store.
    expect(q.totalFils).toBe(q.subtotalFils - q.discountFils + q.vatFils)
    expect(canTransition('DRAFT', 'PENDING_PAYMENT')).toBe(true)
  })

  it('produces totals the database CHECK constraints would accept', () => {
    const q = quote({
      product: 'self_drive', classId: 'economy',
      startDate: '2026-08-01', endDate: '2026-08-15',
      rateCards: [CARD],
      weeklyTiers: [{ rateCardId: 'card-1', minDays: 14, discountBps: 1500 }],
      seasonalRates: [], addons: [], promoCode: null,
      deliveryFeeFils: 5000, oneWayFeeFils: 0, vatBps: 500,
    })
    // Mirrors totals_consistent, totals_non_negative and the integer requirement.
    expect(q.totalFils).toBe(q.subtotalFils - q.discountFils + q.vatFils)
    for (const v of [q.subtotalFils, q.discountFils, q.vatFils, q.totalFils, q.depositFils]) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
    }
  })

  it('refuses to quote a vehicle that availability rejects — the caller must check first', () => {
    const availability = checkAvailability({
      vehicle: { id: 'v1', status: 'available', branchId: 'b1' },
      startsAt: new Date('2026-08-01T06:00:00Z'),
      endsAt: new Date('2026-08-03T06:00:00Z'),
      existingBookings: [{
        id: 'existing', vehicleId: 'v1', status: 'OUT',
        startsAt: new Date('2026-08-02T06:00:00Z'),
        endsAt: new Date('2026-08-04T06:00:00Z'),
      }],
      maintenanceBlocks: [], documentExpiries: [],
      pickupBranchHours: HOURS, returnBranchHours: HOURS,
    })
    expect(availability.available).toBe(false)
    // The engines are independent by design: quote() has no opinion on availability.
    // The booking flow calls both, in this order.
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aa/shared test tests/integration.test.ts`
Expected: PASS immediately — this test uses only existing exports. That is expected; its purpose is to lock the composition. Confirm it passes, then proceed to the coverage gate, which is the part that must fail first.

Run: `pnpm --filter @aa/shared test:coverage`
Expected: FAIL — `Missing script: test:coverage`

- [ ] **Step 3: Write minimal implementation**

Replace `packages/shared/vitest.config.ts`:

```typescript
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
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
})
```

Add to `packages/shared/package.json` scripts:

```json
    "test:coverage": "vitest run --coverage",
```

Add a step to `.github/workflows/ci.yml`, after the existing database-test assertion:

```yaml
      - name: Enforce domain engine coverage (NFR-9)
        run: pnpm --filter @aa/shared test:coverage
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aa/shared test:coverage`
Expected: PASS — all four thresholds met. If any metric is below 90, the uncovered lines are named in the output; add tests for them rather than lowering the threshold.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/vitest.config.ts packages/shared/package.json packages/shared/tests/integration.test.ts .github/workflows/ci.yml
git commit -m "test(shared): enforce 90% coverage on the domain engines"
```

---

## Definition of done

- [ ] `pnpm test` passes — root + `@aa/db` + `@aa/shared`, exit 0
- [ ] `pnpm --filter @aa/shared test:coverage` meets all four 90% thresholds
- [ ] `pnpm typecheck` passes with zero errors and **covers `packages/shared/tests`**
- [ ] `packages/shared` has no runtime dependency on `@aa/db`, no database client, no `fetch`
- [ ] CI is green
- [ ] `VEHICLE_HOLDING_STATUSES` matches migration `0017`'s status filter exactly

## What this plan deliberately excludes

- **No database queries.** Callers fetch rows and pass them in. That is what makes these functions testable exhaustively and shareable with the Expo app.
- **No `apps/web`.** P1.3 onwards.
- **No lease or chauffeur pricing.** P2. `quote()` accepts the product but only self-drive rules are implemented; a lease quote is a later task.
- **No excess-mileage billing.** The quote returns `includedKmTotal` and `excessKmRateFils` so the return flow can compute it, but the charge itself belongs to P1.7's handover work.
- **No promo usage-cap enforcement.** `quote()` validates product scope and minimum value. The `totalUsageCap` and `perCustomerCap` checks need a database read and belong in the booking flow — see the concurrency warning in `P1-01-FOLLOW-UPS.md`.
