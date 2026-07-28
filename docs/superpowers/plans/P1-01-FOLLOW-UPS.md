# P1.1 — Carried-forward findings

Findings deliberately deferred during P1.1 (foundation and data model), recorded here so the
plans that inherit this schema do not rediscover them. Each names the phase that owns it.

Source: per-task reviews and the final whole-branch review of branch `p1-01-foundation`.

---

## Must be resolved in P1.2 — domain engines

**No database guard against overlapping bookings existed until late in P1.1.**
Migration `0017` now adds an `EXCLUDE USING gist` constraint preventing two bookings in status
`CONFIRMED`, `DOCS_VERIFIED`, `READY_FOR_PICKUP` or `OUT` from overlapping on one vehicle. That
is a **backstop, not the mechanism**. The availability engine is the primary guard and needs
heavy testing — a booking rejected by the exclusion constraint reaches the customer as a
database error, not a graceful "no longer available" message.

**`selfDriveDetails` 1:1 cardinality is unenforced.** `bookingId` is the primary key, so
at-most-one is guaranteed. Nothing requires a `self_drive` booking to *have* a detail row, or
forbids a chauffeur booking from having one. Needs a trigger or service-layer discipline.

---

## Must be resolved in P1.5 — payments, deposits, invoicing

**`payments.refundedFils` has a lost-update race.** It is a single mutable column guarded by
`refund_within_amount`. Two concurrent read-modify-write refunds can each satisfy the CHECK
independently while jointly over-refunding the customer — the CHECK cannot see another
transaction's uncommitted delta. The correct fix is an append-only refund ledger with a
trigger-maintained total, or row locking on every refund path. **Do not build refund logic on
the current shape.**

**`invoices` has no line items.** Nothing links `charges` or `bookingAddons` to the invoice
that bills them. Invoice totals are free-floating integers: double-invoicing the same charge is
undetectable, and reconciliation from the data alone is impossible. Decide the shape — a
`charges.invoiceId` column, or a proper `invoice_lines` table — before billing code exists.

**`promoCodes.timesUsed` is unlocked.** No `CHECK (times_used <= total_usage_cap)` and no
locking. Concurrent redemptions can exceed the cap. Redemption needs `SELECT ... FOR UPDATE`
or an atomic conditional `UPDATE`.

---

## Must be resolved in P1.7 — fleet, admin and settings

**`settings.isSecret` encrypts nothing.** NFR-18.6 requires integration credentials "stored
encrypted at rest". `isSecret` is currently only a hint that the settings UI should render the
field write-only. Nothing stops `SELECT value FROM settings WHERE is_secret`. Encryption
belongs at the application layer — pgcrypto or KMS wrapping before insert — and must land with
the settings screen, not after it.

**`settings.value` is unconstrained `jsonb`.** Nothing forces `vat_bps` to be a positive
integer, or to exist at all. A CHECK cannot sensibly cover heterogeneous key shapes; a typed
Zod accessor is the right layer.

---

## Must be resolved in P2

**`self_drive_needs_vehicle` does not cover `lease`.** The CHECK reads
`product <> 'self_drive' OR vehicle_id IS NOT NULL`. A monthly lease needs a vehicle just as
much. Not load-bearing in P1 because lease bookings cannot be created. When `leaseDetails`
lands, change it to `product NOT IN ('self_drive','lease') OR vehicle_id IS NOT NULL`.

---

## Test backlog — any phase

**Roughly eighteen constraints have no test.** A constraint with no test is one refactor from
being silently dropped. The full list is in the final fix report; the notable ones are
`weekday_range`, `opens_before_closes`, `year_sane`, `vehicle_document_unique`,
`validity_ordered`, `discount_bps_range`, `blacklist_requires_reason`,
`rejection_requires_reason`, `hold_amount_positive`, `invoice_totals_non_negative`,
`quantity_positive` and `x/y_percent_range`.

**`booking.test.ts` "accepts every state in the spec state machine"** queries `pg_enum` and
asserts the enum contains the values the enum defines. It checks the schema against itself, not
against the spec. It should assert against a literal list drawn from spec §4.

**`content.test.ts:59`** matches `/duplicate key value/` rather than a named constraint. Every
other `rejects.toThrow()` in the suite names the constraint it proves.

---

## Operational notes

**The application's database role must not hold `TRUNCATE`** on `handovers` or
`inspection_photos`. Row-level triggers protect them against UPDATE and DELETE, but `TRUNCATE`
fires no row triggers and would erase dispute evidence silently. Recorded in the runbook's
security checklist.

**Migration `0013` fails on any database that already accumulated duplicate `branch_hours`
rows** from pre-fix reseeds. Dedupe before applying. Irrelevant to fresh databases.

**Two migrations are hand-written and invisible to drizzle-kit** — `0008` (handover append-only
triggers) and `0010` (gapless invoice numbering), plus `0015`–`0017`. `drizzle-kit generate`
emits `ALTER TABLE`, never DROP/CREATE, so triggers survive column additions, and the behaviour
is asserted by tests. The one live hazard: adding `.references()` to `handovers.supersededById`
in the Drizzle schema would create a second, non-deferrable foreign key and break
supersede-in-one-transaction. The comment in `handover.ts` is the only warning.

**`invoice_sequence` is invisible to drizzle.** If anyone later adds it to `money.ts` for
type-safe querying, `generate` will emit `CREATE TABLE` for a table that already exists.
