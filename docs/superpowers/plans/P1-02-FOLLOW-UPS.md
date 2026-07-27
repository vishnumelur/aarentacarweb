# P1.2 — Carried-forward findings

Findings deliberately deferred during P1.2 (domain engines: availability, pricing, state
machine), recorded here so the plans that inherit this code do not rediscover them. Each names
the phase that owns it.

Source: per-task reviews and the final whole-branch review of branch `p1-01-foundation`.

---

## Must be resolved in P1.3 — booking flow

**`quote()` throws on a missing rate card.** This is deliberate — a missing rate card is a
configuration error for the whole vehicle class, not a per-booking condition, and silently
returning no price would hide it. FR-1.4 requires every search result to show a total, so P1.3
will loop `quote()` over many vehicles. Callers rendering a list must filter out classes with no
current rate card before quoting, or guard each call — one unpriceable class must not take down
a search page.

**`VehicleForAvailability.branchId` is accepted but never read.** `checkAvailability` takes a
`branchId` on the vehicle and does nothing with it. Callers must filter candidate vehicles by
pickup branch themselves before calling the engine; it will not do that filtering for you.

**`QuoteInputSchema` types dates as bare `z.string()`.** `startDate` and `endDate` accept any
string, so `2026-13-45` passes validation and reaches `quote()`, which throws a generic date
error instead of the boundary rejecting it as a validation failure. Tighten both fields to a
`YYYY-MM-DD` regex (`/^\d{4}-\d{2}-\d{2}$/`) before this schema is used as an API boundary.

---

## Must be resolved in P1.5 — payments, deposits, invoicing

**`quote()` cannot supply `bookings.promoCodeId`.** `PromoCode` (in `pricing/types.ts`) carries
`code` but no `id`. A `QuoteResult` tells the caller a promo applied, but persisting the booking
needs the promo's primary key, so the caller must re-look-up the promo by `code` to get the
foreign key. Either add `id` to `PromoCodeSchema` or accept the extra lookup as the intended
shape — decide before the booking-creation path is written.

---

## Must be resolved in P1.7 — fleet, admin and settings

**`toMinutes` (in `availability/opening-hours.ts`) treats `Number('')` as `0` rather than
throwing, and has no range check.** `toMinutes('')` returns `0` instead of failing, and nothing
rejects `'99:99'` as out of range. Harmless today because every input comes from a `NOT NULL`
Postgres `time` column, but the branch-hours editor P1.7 builds will let staff post arbitrary
strings through this same path. Add a range check (`0 <= hours < 24`, `0 <= minutes < 60`) and
reject empty segments explicitly.

---

## Must be resolved in P2

**FR-2.6 promo validity-window and usage-cap checks are unimplemented.** `quote()` checks
`applicableProducts`, `minBookingValueFils` and the percent-over-100 case, but nothing checks
`validFrom`/`validTo` or `timesUsed` against `totalUsageCap` — and `PromoCode` (the Zod type in
`pricing/types.ts`) has no fields for them at all. `promoRejectedReason` reads as a complete
union of rejection causes; it is not. Add the fields and the checks together so the type and the
logic stay honest with each other.

**The seasonal tie-break chain is not total.** `resolveSeasonalRate` breaks ties by priority,
then by narrower window, then by `name` lexically — but two rules for the same class with the
same priority, the same span, and the same `name` are indistinguishable, and the function will
silently pick one via `reduce` without the caller knowing the result was arbitrary. Consider a
unique index on `(class_id, name)` to make the collision impossible rather than merely unlikely.

**Seasonal rates resolve from `startDate` only.** `quote()` calls `resolveSeasonalRate` once,
against `input.startDate`. A rental that crosses a season boundary — books outside the peak
season and returns inside it, or vice versa — prices entirely at the start-date rule for every
day of the rental. FR-2.3 does not obviously permit this; decide whether day-by-day proration
across season boundaries is required and, if so, redesign `quote()`'s single-card assumption.

---

## Must be resolved: database migration

**`promo_codes` permits a percent `discount_value` above 100.** The `discount_value_positive`
CHECK only requires `> 0`; nothing stops `discount_type = 'percent'` with `discount_value =
150`. `quote()` catches this at read time (`invalid_discount_value`), but the bad row is still
storable and any other reader would not know to guard against it. Add
`CHECK (discount_type <> 'percent' OR discount_value <= 100)`.

---

## Carried forward unresolved from P1.1

**`selfDriveDetails` 1:1 cardinality is still unenforced.** Nothing in P1.2 touches persistence,
so nothing here could address it. Restating so it is not dropped: `bookingId` being the primary
key guarantees at-most-one, but nothing requires a `self_drive` booking to *have* a detail row,
or forbids a chauffeur booking from having one. Still needs a trigger or service-layer
discipline, owned by whichever phase writes booking-creation code (P1.3).

---

## Packaging

**`packages/shared/package.json` points `main` at raw TypeScript** (`./src/index.ts`), not a
build output. This works for the workspace's own Vitest/tsc tooling but is not consumable as-is
by either downstream runtime: Next.js will need `transpilePackages: ['@aa/shared']` in
`next.config`, and Metro (the Expo app) will need its resolver configured to transpile the
package rather than expect pre-built JS. Neither is configured yet because no downstream package
imports `@aa/shared` at this point in the branch.

---

## Recorded deviation

**`canTransition(from, to)` is two-argument while spec §4 names `canTransition(from, to, ctx)`.**
Ruling: the graph in `state-machine.ts` answers structural legality, which is context-free —
"can a booking ever move from CONFIRMED to OUT" does not depend on which booking. Contextual
guards (has the deposit cleared, is the vehicle actually present) depend on database state and
belong in the service layer that calls `canTransition`, not inside the pure graph. Documented
here so P1.3, which will write that service layer, does not re-litigate the signature.
