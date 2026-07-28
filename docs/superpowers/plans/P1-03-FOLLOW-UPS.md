# P1.3 — Carried-forward findings

Findings deliberately deferred during P1.3 (authentication and accounts), recorded here so the
plans that inherit this code do not rediscover them. Each names the phase that owns it. The
`.superpowers/sdd/2026-07-28-p1-03-auth-and-accounts/progress.md` ledger this was extracted from
is gitignored scratch and will be deleted; this file is the durable record.

Source: per-task reviews and the final whole-branch review of branch `p1-01-foundation`.

---

## Must be resolved in P1.4 — protected routes

**FR-11.1 branch scoping is unenforced.** `SessionUser.branchId` is carried on every resolved
session, but `requireRole` (in `apps/web/src/auth/guard.ts`) only checks `role` against an
allow-list — nothing checks that a staff member's `branchId` matches the branch a route is
acting on. A member of staff at Branch A can act on Branch B's bookings through any endpoint
that only calls `requireRole`. P1.4 needs a `requireBranchScope` helper (same shape as
`requireRole`: takes the deps, the request, and the branch the operation targets) before it
builds routes that assume branch isolation.

**The error envelope is inconsistent, and it leaks to the customer.** Routes mix machine-readable
codes (`invalid_phone`, `cooldown`, `ip_rate_limited`) with ad hoc prose (`'phone is required'`,
`'phone and code are required'`), and `apps/web/src/app/login/page.tsx` renders
`body.error` verbatim in the UI — a customer who is rate-limited literally sees the string
"cooldown" on screen. `guard.ts`'s new `toResponse` helper (added in this fix wave) returns
`AuthError.message`, which is prose, compounding the inconsistency for 401/403s. Settle one
envelope shape (e.g. `{ error: { code, message } }` with `code` always machine-readable and
`message` always customer-safe) before P1.4 multiplies the number of routes that would need
retrofitting.

**Route tests cannot inject a `Clock`.** Every route handler under `apps/web/src/app/api/v1/auth/`
constructs its deps with the hardcoded `systemClock`, not an injected one, unlike every function
it calls (`requestOtp`, `verifyOtp`, `createSession`, `resolveSession` all take a `Clock`
parameter precisely so tests do not need to sleep). The consequence: `apps/web/tests/routes.test.ts`
can exercise happy paths and immediate failures over real HTTP, but nothing there proves a
cooldown actually returns 429, a locked-out OTP actually returns 429, or an expired session
actually returns 401 — those all need to fast-forward time, and the routes give test code no way
to do that. P1.4's route handlers should accept (or read from a request-scoped context) an
injectable clock from the start rather than retrofitting it under time pressure later.

---

## Must be resolved in P1.6 — accounts and PDPL rights

**FR-13.8 is unreachable.** `exportPersonalData` and `anonymiseUser`
(`apps/web/src/auth/pdpl.ts`) are fully implemented and unit-tested, but no route calls either
one. A customer today has no way to exercise their PDPL right to access or erasure — the
capability exists only as a library function nothing in the running application invokes. P1.6
owns wiring both into authenticated, rate-limited routes (erasure in particular should require
re-authentication or a confirmation step given it is irreversible).

**`exportPersonalData` is incomplete and must be widened before any route exposes it.** It
currently returns only the `users` and `customers` rows. It omits `customerDocuments` (which
holds Emirates ID, passport and driving licence numbers — some of the most sensitive personal
data the platform holds), `sessions`, and `bookings`. Shipping the current shape behind a "your
data" route would tell a customer their export is complete when it materially is not, which is
arguably worse than not offering export at all. Widen the query before wiring in the route, not
after.

---

## Build tooling — no phase currently owns this

**Turbopack is unusable for this app.** `@aa/db` and `@aa/shared` ship raw TypeScript with
`./x.js`-suffixed specifiers (the TS "NodeNext"-style convention), which Turbopack cannot
resolve. `dev` and `build` in `apps/web/package.json` both pass `--webpack` plus an
`extensionAlias` experiment as a workaround. This works today, but webpack is on Next.js's own
deprecation path — revisit deliberately (either build the two packages to real `.js` output, or
confirm Turbopack has closed this gap) before webpack support is removed out from under this
app.

---

## Operational notes

**Expired session rows are never deleted.** `sessions.expiresAt` is enforced at read time
(`resolveSession` filters on it), so an expired row is never usable — this is storage growth,
not a correctness or security gap. Nobody currently owns a cleanup job. Low priority; worth a
scheduled `DELETE ... WHERE expires_at < now()` whenever a job runner exists for other purposes.

---

## Explicitly excluded from P1.3 — record so they are not forgotten

**FR-13.5 (password reset) and FR-13.9 (account lockout after repeated failures)** were both
scoped out of P1.3 deliberately — this phase implemented OTP-based sign-in only, with no
password credential to reset and no separate lockout policy beyond the OTP attempt/cooldown
limits in `otp.ts`. Neither has an owning phase yet. Whichever phase adds a password-based
credential (staff/owner login, if that is ever built separately from OTP) must implement both
together, since a reset flow without a lockout policy on the reset request itself is a fresh
attack surface.
