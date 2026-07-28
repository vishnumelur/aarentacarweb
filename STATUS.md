# AA Rentals — project status

**Last updated:** 2026-07-28 · `main` at `2a9c74a` · 87 commits · **339 tests passing** · CI green

Read this first when picking the project back up. It is the map; the spec is the contract.

---

## What this is

A booking platform for **Auto Assist Service (AA Rentals)**, a Dubai car rental business with
two branches — Al Karama and Dubai Media City. Replaces a WordPress/WooCommerce site that has
no booking engine, no published rates and no availability, where enquiries arrive by phone and
WhatsApp.

Four portals eventually: customer, chauffeur, manager, owner. One database. A React Native /
Expo app later, sharing the same API and the same pricing code.

---

## Where it stands

**Roughly 35% of Phase 1 by effort. One of 83 screens exists.**

That ratio is normal for this shape of build — the foundation carries the risk, which is where
the defects were found.

| Phase | State | What it delivered |
|---|---|---|
| **P1.1** Foundation & data model | ✅ merged | Monorepo, 24 tables, 20 migrations, seed, CI |
| **P1.2** Domain engines | ✅ merged | Availability, pricing quote, booking state machine |
| **P1.3** Auth & accounts | ✅ merged | Phone-OTP sign-in, sessions, role guards, PDPL erasure |
| **P1.4** Public booking flow | ⬜ next | Search → vehicle → checkout. **First recognisable product** |
| P1.5 Payments & invoicing | ⬜ | Gateway, deposit holds, VAT invoices |
| P1.6 KYC & customer portal | ⬜ | Document upload, verification queue |
| P1.7 Fleet, admin & handover | ⬜ | Ops dashboard, inspections, settings |

Then P2 (chauffeur, lease, charges) and P3 (analytics, the Expo app).

---

## Running it

```bash
# 1. Services — Postgres 17, Redis 7, MinIO
docker compose -f docker-compose.dev.yml up -d
./scripts/check-services.sh          # probes TCP; needs no client tools

# 2. Database
pnpm db:migrate && pnpm db:seed      # 20 migrations, then real branches + sample fleet

# 3. The app
pnpm --filter @aa/web dev            # http://localhost:3000
```

**Sign in:** open `/login`, enter any UAE mobile — `0501234567`, `971501234567` and
`+971 50 123 4567` all work. The code prints to the dev server console, because
`NOTIFY_DRIVER=console`. No SMS provider is wired up yet.

**Everything else:**

```bash
pnpm test          # 339 tests across four packages
pnpm typecheck     # covers every .ts including tests
```

Browse the database at **https://local.drizzle.studio** after `pnpm --filter @aa/db exec drizzle-kit studio`.
MinIO console at **localhost:9001**, `minioadmin` / `minioadmin`.

### Two environment traps

- **Docker group membership does not apply to a running shell.** After `usermod -aG docker`,
  open a new terminal or prefix the first run with `sudo`.
- **Client tools are not installed by starting containers.** `sudo apt-get install -y
  postgresql-client redis-tools` if you want `psql`.

---

## What exists

```
packages/db      24 tables, 20 migrations, Drizzle schema, idempotent seed
packages/shared  availability engine · pricing quote · booking state machine (pure, no I/O)
apps/web         Next.js 16 · login page · 4 auth routes
```

**Five migrations are hand-written** — `0008`, `0010`, `0015`, `0016`, `0017` — carrying plpgsql
triggers and constraints Drizzle cannot express. Never regenerate them. `drizzle-kit generate`
must only ever add a new file.

### Decisions worth knowing

- **Money is integer fils everywhere.** 1 AED = 100 fils, columns suffixed `_fils`. No float
  touches currency. All rounding is confined to `packages/shared/src/money.ts`.
- **Bookings pin their rate card.** Changing a price never reprices history.
- **Invoice numbers are gapless**, allocated by a counter row advanced inside the caller's
  transaction. A Postgres sequence cannot do this — a rolled-back insert burns a number, and
  UAE tax law forbids the gap.
- **Handover records and inspection photos are append-only, enforced by triggers.** They are
  the evidence that decides damage disputes; a comment would not have been enough.
- **A vehicle cannot be double-booked** — an `EXCLUDE USING gist` constraint is the backstop,
  the availability engine is the primary guard, and the two are cross-checked by a test that
  parses the migration off disk.
- **Sessions expire 30 days from creation, not from last activity** — a deliberate deviation
  from FR-13.7's original wording, taken to avoid a database write on every request. The spec
  was updated to match.

---

## Do these before P1.4

1. **Real rate cards.** Every price is a placeholder I invented — Economy AED 120/day through
   Sports AED 1,500. The engine computes correctly, but P1.4 puts these figures in front of
   customers. This is the one item genuinely blocking business validation.
2. **Choose a payment gateway.** Telr, Network International N-Genius, PayTabs and Stripe all
   support auth/capture in the UAE. **Merchant account approval takes weeks** — start the
   application now, in parallel, whichever you pick. It is the longest lead time in the project.
3. **Revoke the exposed PAT** at `github.com/settings/tokens`. A token with account-wide `repo`
   scope was pasted into a chat transcript. Replace it with a fine-grained token scoped to this
   repository only, or an SSH deploy key.
4. **Make the repo private** if you want to. It is public, and while nothing secret is committed,
   the infrastructure layout is now readable.

---

## Deferred work, by owner

Full detail in the follow-up docs — read the one for your phase before starting it.

- [`P1-01-FOLLOW-UPS.md`](docs/superpowers/plans/P1-01-FOLLOW-UPS.md)
- [`P1-02-FOLLOW-UPS.md`](docs/superpowers/plans/P1-02-FOLLOW-UPS.md)
- [`P1-03-FOLLOW-UPS.md`](docs/superpowers/plans/P1-03-FOLLOW-UPS.md)

**The load-bearing ones:**

| Owner | Item |
|---|---|
| **P1.4** | `requireBranchScope` does not exist — FR-11.1 branch scoping is carried but unenforced |
| **P1.4** | Settle the API error envelope before more routes multiply the inconsistency |
| **P1.5** | **Do not build refunds on `payments.refundedFils` as it stands** — a single mutable column with a lost-update race |
| **P1.5** | `invoices` has no line items; nothing links a charge to the invoice billing it, so double-invoicing is undetectable |
| **P1.6** | FR-13.8 has no route — a customer cannot actually export or erase their data |
| **P1.6** | `exportPersonalData` omits KYC documents, sessions and bookings. A partial export presented as complete is worse than none |
| Any | Turbopack cannot resolve the workspace packages' `.js` specifiers; `--webpack` is the workaround and webpack is on Next's way out |

---

## Resuming with an agent

Paste this:

> Continue the AA Rentals build. Read `STATUS.md`, then
> `docs/superpowers/specs/2026-07-27-aa-rentacar-design.md` (the approved spec) and the
> `P1-0*-FOLLOW-UPS.md` files for carried constraints.
>
> P1.1, P1.2 and P1.3 are merged to `main`: `packages/db` (24 tables, 20 migrations),
> `packages/shared` (availability, pricing, state machine — pure functions), and `apps/web`
> (Next.js, phone-OTP sign-in). 339 tests passing, CI green.
>
> Next is **P1.4 — the public booking flow**: home with a search widget, results, vehicle
> detail, and a four-step checkout ending at a confirmed booking. Screens 1–8 and 12 of the
> spec, implementing FR-1, FR-3, FR-18 and FR-22's legal pages.
>
> Use the brainstorming skill if the scope needs sharpening, then writing-plans, then
> subagent-driven development. Test-first, and do not mock what matters: real Postgres, an
> injected clock, real HTTP against route handlers.
>
> Docker Postgres runs on `localhost:5432`, migrated and seeded. Import workspace packages as
> `import { createDb, schema } from '@aa/db'` — never a deep path.

---

## How this was built

Every phase went: spec → plan → task-by-task implementation, each task reviewed and re-reviewed,
then a whole-branch review before merge.

**Around 60 defects were found and fixed before reaching `main`.** Almost all originated in the
plans rather than in the code written from them. The most common failure by a wide margin was
**something that read as protection and provided none** — a typecheck that skipped test files,
a CI run that executed zero database tests, a coverage gate measuring the average instead of
each file, a test comparing a table against itself, an index built for a query never written,
and a hash whose comment described a property it did not have.

The question that caught nearly all of them was not *"does this pass?"* but *"would this fail
if the thing it guards were broken?"* Worth keeping as the habit.
