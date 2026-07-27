# AA Rent A Car — Platform Design Spec

**Date:** 2026-07-27
**Status:** Approved for phase 1 planning
**Repo:** https://github.com/vishnumelur/aarentacarweb

---

## 1. Overview

A Dubai-based car rental platform with four portals (customer, chauffeur, manager, owner)
served from a single database, plus a React Native / Expo mobile app that consumes the same
API. The website ships first; the app follows.

### Business model

AA Rent A Car owns the entire fleet. "Owner" means the business proprietor, not third-party
car owners. There is no marketplace, no partner onboarding, no commission engine and no
payout ledger. The owner portal is an executive and finance layer above day-to-day operations.

### Products sold

| Product | Pricing shape | Portal impact |
|---|---|---|
| Self-drive daily / weekly | Per-day with weekly discount tiers | Core booking engine |
| Self-drive monthly lease | 1–12 month term, monthly invoicing | Separate rate table and billing schedule |
| Chauffeur hourly | 4h / 8h / 12h city packages | Requires roster and dispatch |
| Chauffeur transfers | Fixed price zone→zone (DXB, DWC, intercity) | Requires flight tracking and waiting rules |

### Payment methods

- Online card with security deposit taken as a pre-authorisation hold
- Pay at pickup (card machine or cash)
- BNPL via Tabby / Tamara

Corporate credit accounts and monthly invoicing are explicitly **out of scope**.

### Operations in scope

- Digital handover with damage inspection, photos and e-signature
- Salik toll and traffic fine passthrough
- Maintenance, service scheduling and vehicle document expiry tracking
- Customer KYC document verification

---

## 2. Architecture

### Decision: Turborepo monorepo, Next.js hosts the API

```
aarentacarweb/
├── apps/
│   ├── web/            Next.js 16 App Router — public site + all 4 portals + /api/v1
│   ├── mobile/         Expo (React Native) — customer app + chauffeur app
│   └── worker/         Node process — BullMQ consumer for background jobs
├── packages/
│   ├── db/             Drizzle schema + migrations (single source of truth)
│   ├── shared/         Zod schemas, pricing engine, booking state machine, types
│   └── ui/             Design tokens and shared primitives
└── docs/
```

**The mobile app never connects to Postgres directly.** It calls the same versioned REST API
(`/api/v1/*`) the website uses, and imports `packages/shared` so request and response types
are compile-time identical to the server.

### Why this over the alternatives

Pricing rules and the booking state machine are written once and executed on the server, the
web client and the phone. Divergent quotes between channels are the single most common defect
class in rental systems, and a shared package eliminates the category. It is also the cheapest
option to operate on one Proxmox node.

Rejected: a split NestJS backend (three deploys and duplicated DTOs, buying nothing at this
scale) and Supabase/BaaS (row-level-security CRUD does not accommodate weekly tiers, lease
schedules, hourly packages, deposits and toll passthrough).

If the API ever needs independent scaling, `apps/api` is extracted from the route handlers —
the shared packages make that a lift rather than a rewrite.

### Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16, App Router, React Server Components |
| Language | TypeScript, strict mode |
| Database | PostgreSQL 17 |
| ORM | Drizzle |
| Cache / queue | Redis 7 + BullMQ |
| Object storage | MinIO (S3-compatible) |
| Auth | Session-based, phone OTP primary, email/password secondary, TOTP 2FA for staff |
| Styling | Tailwind CSS + shadcn/ui |
| Validation | Zod, shared client and server |
| Mobile | Expo SDK, React Native |
| Reverse proxy | Caddy (existing, LXC 100) |
| CI/CD | GitHub Actions → GHCR → `docker pull` on node |

---

## 3. Infrastructure

Deployed to the existing Hetzner-PVE Proxmox cluster, backed up by PBS-Local, fronted by the
existing Caddy container.

### Container layout

| LXC | vCPU | RAM | Disk | Purpose |
|---|---|---|---|---|
| `aa-postgres` | 2 | 4 GB | 60 GB NVMe | Postgres 17. `shared_buffers=1GB`, `effective_cache_size=3GB` |
| `aa-web` | 4 | 6 GB | 20 GB | Next.js in Docker, 2 cluster workers |
| `aa-worker` | 1 | 1.5 GB | 10 GB | BullMQ: Salik sync, deposit release, expiry alerts, PDF generation, notifications |
| `aa-redis` | 1 | 1 GB | 10 GB | Queue, session, rate limit, quote cache. `maxmemory 768mb`, `allkeys-lru` |
| `aa-minio` | 1 | 2 GB | 250 GB NVMe | Inspection photos, KYC documents, contract PDFs |
| `caddy` | — | — | — | Existing container; add vhost only |

### Sizing requirement

Assumes 300–800 bookings/month, ~100 vehicles, 30–60k web visitors/month, 10–20 staff and
chauffeurs, peak season November–March.

| Environment | vCPU allocated | Real cores | RAM | NVMe |
|---|---|---|---|---|
| Dev / staging | 2 | 1 | 4 GB | 40 GB |
| **Production at launch** | **9** | **~6** | **16 GB** | **350 GB** |
| Year 2 at 3× volume | 12 | ~8 | 24 GB | 750 GB |

These figures are **in addition to** existing workloads on the node (`pbs`, `monitoring`,
`panel`, `la-mirage-in`, `INV-DEV-SRV-1`). RAM is the hard constraint — LXC does not
oversubscribe it. Cores are a scheduling weight; 6 real cores carry 9 allocated vCPU at this
volume.

Growth path: add RAM before cores. Postgres to 8 GB and web to 8 GB covers 3× volume at the
same core count.

### Operational constraints

1. **Never run `next build` on the production node.** A build of this application peaks at
   4–6 GB RAM and saturates every core for minutes, which will OOM neighbouring containers.
   Build in GitHub Actions, push to GHCR, pull the image on the node.
2. **Photo storage grows at ~10 MB per booking** (≈12 photos at pickup, ≈12 at return,
   compressed to ~400 KB each). At 500 bookings/month that is 5 GB/month and 60 GB/year, and
   UAE dispute resolution requires multi-year retention. A lifecycle policy keeps full
   resolution for 12 months then downscales; archive tier goes to a Hetzner Storage Box.
3. **Postgres and MinIO must sit on NVMe.** PBS must run a `pg_dump` pre-backup hook against
   `aa-postgres` — a filesystem snapshot of a live Postgres is not a reliable restore point.

---

## 4. Domain model

### Roles

| Role | Who | Scope |
|---|---|---|
| Customer | Tourist or UAE resident | Web portal and app. Own bookings only |
| Chauffeur | Employed driver | App primarily, thin web view. Only assigned trips |
| Staff / Manager | Counter and operations team | Web admin, scoped by branch |
| Owner | Business proprietor | Web admin, all branches, read-heavy analytics and configuration |

Owner permissions are a superset of Manager, but the owner portal is a **distinct UI**, not
the manager portal with extra buttons. Owner screens answer "is the business healthy"; manager
screens answer "what do I do in the next hour".

### Entities

```
identity   User · Role · Session · AuditLog
customer   Customer · CustomerDocument(EID|passport|visa|licence|IDP)
fleet      Vehicle · VehicleClass · VehicleDocument(mulkiya|insurance|inspection)
           VehiclePhoto · Branch · MaintenanceJob · ServiceSchedule
pricing    RateCard · SeasonalRate · WeeklyTier · MonthlyPlan
           ChauffeurPackage(4h|8h|12h) · TransferRoute(zone→zone) · Addon · PromoCode
booking    Booking ──┬─ SelfDriveDetail  (pickup/return branch, mileage cap)
                     ├─ LeaseDetail      (term, monthly billing schedule)
                     └─ ChauffeurDetail  (package|route, flight no, stops)
           BookingAddon · Handover(pickup|return) · DamageMarker · InspectionPhoto
dispatch   Chauffeur · ChauffeurShift · TripAssignment · TripEvent
money      Payment · DepositHold · Refund · Invoice
           Charge(salik|fine|damage|late|fuel|cleaning)
system     Notification · WebhookEvent · Setting
```

**One `Booking` table with three detail tables**, not three parallel booking tables.
Everything downstream — payments, charges, documents, notifications, "my bookings" — then
operates uniformly, while product-specific fields stay isolated.

### Booking state machine

```
DRAFT → PENDING_PAYMENT → CONFIRMED → DOCS_VERIFIED
      → READY_FOR_PICKUP → OUT → RETURNED → CLOSING → COMPLETED

side exits:      CANCELLED · NO_SHOW · EXPIRED
chauffeur adds:  ASSIGNED → EN_ROUTE → ARRIVED → IN_TRIP → DROPPED
```

Implemented in `packages/shared` as a pure `canTransition(from, to, ctx)`. The server enforces
it; web and mobile read from it to decide which actions to render. No state logic is duplicated.

### Load-bearing shared components

Three pieces carry disproportionate weight and are built once:

1. **Availability engine** — resolves whether a vehicle is bookable for a date range,
   accounting for existing bookings, maintenance blocks and expired documents.
2. **Handover / inspection flow** — identical component on web (staff) and mobile
   (chauffeur), covering checklist, photo capture, damage diagram and signature.
3. **Pricing quote function** — one input shape, one output shape, four products.

---

## 5. Page inventory

83 screens. Phase tags: **P1** web MVP, **P2** chauffeur and depth, **P3** analytics and app.

### A. Public site — 15 pages

| # | Page | Phase | Notes |
|---|---|---|---|
| 1 | Home | P1 | Hero search: product tabs, location, date-time range |
| 2 | Search results / fleet | P1 | Filters by class, seats, transmission, price, features. Live availability |
| 3 | Vehicle detail | P1 | Gallery, specs, rate breakdown, mileage cap, deposit, terms |
| 4 | Booking step 1 — extras | P1 | Extra driver, child seat, GPS, insurance upgrade, unlimited km, delivery |
| 5 | Booking step 2 — your details | P1 | Guest or logged-in, phone OTP |
| 6 | Booking step 3 — documents | P1 | Licence / EID / passport upload inline |
| 7 | Booking step 4 — payment | P1 | Card, pay-at-pickup, Tabby. Deposit pre-auth disclosure |
| 8 | Confirmation | P1 | Booking reference, voucher PDF, add to calendar |
| 9 | Monthly lease landing | P2 | Enquiry form and pricing table |
| 10 | Chauffeur services | P2 | Hourly packages |
| 11 | Airport transfer | P2 | DXB/DWC fixed routes, flight number |
| 12 | Locations / branches | P1 | Map, hours, delivery zones |
| 13 | Offers & deals | P2 | Promo landing |
| 14 | Legal set | P1 | Terms, privacy, rental agreement, insurance and liability, cancellation |
| 15 | About · FAQ · Contact · Blog | P1 / P3 | Blog is P3; routes planned in P1 for SEO |

### B. Customer portal — 14 screens

| # | Screen | Phase |
|---|---|---|
| 16 | Login / register (phone OTP primary) | P1 |
| 17 | Dashboard — active rental, next pickup, alerts | P1 |
| 18 | My bookings — upcoming / active / past | P1 |
| 19 | Booking detail — contract, handover report, status timeline | P1 |
| 20 | Modify / extend booking | P2 |
| 21 | Cancel booking with refund preview | P1 |
| 22 | My documents — upload, status, expiry warnings | P1 |
| 23 | Payments & invoices | P1 |
| 24 | Charges — Salik, fines, damage, late fees, pay now | P2 |
| 25 | Deposit status — held / released / deducted | P1 |
| 26 | Saved cards | P2 |
| 27 | Profile & settings | P1 |
| 28 | Notifications | P2 |
| 29 | Support / raise a dispute | P2 |

### C. Chauffeur portal — 11 screens (app-first, thin web)

| # | Screen | Phase |
|---|---|---|
| 30 | Login | P2 |
| 31 | Today — my shift and next trip | P2 |
| 32 | Assigned trips list | P2 |
| 33 | Trip detail — customer, route, flight, stops | P2 |
| 34 | Trip execution — start / arrived / in-trip / drop, odometer | P2 |
| 35 | Handover inspection (shared with staff) | P2 |
| 36 | Availability & shift schedule | P2 |
| 37 | Trip log & earnings | P2 |
| 38 | Expense submission — fuel, parking, Salik | P3 |
| 39 | My documents — licence expiry | P2 |
| 40 | Notifications | P2 |

### D. Manager / staff portal — 31 screens

| # | Screen | Phase |
|---|---|---|
| 41 | Login + 2FA | P1 |
| 42 | Ops dashboard — today's pickups, returns, overdue, unassigned, expiring documents | P1 |
| 43 | Bookings list with advanced filters | P1 |
| 44 | Booking detail / edit | P1 |
| 45 | Create walk-in booking (counter) | P1 |
| 46 | Fleet availability calendar — vehicle × date Gantt | P1 |
| 47 | Dispatch board — chauffeur to trip assignment | P2 |
| 48 | Handover: pickup — checklist, photos, damage diagram, fuel, odometer, e-signature | P1 |
| 49 | Handover: return — comparison against pickup, new damage, charges | P1 |
| 50 | Fleet list | P1 |
| 51 | Vehicle detail — documents, service history, utilisation, revenue | P1 |
| 52 | Add / edit vehicle | P1 |
| 53 | Document expiry board — mulkiya, insurance, inspection | P1 |
| 54 | Maintenance & workshop jobs | P2 |
| 55 | Service schedule by km or date | P2 |
| 56 | Customers list | P1 |
| 57 | Customer detail — history, documents, blacklist flag | P1 |
| 58 | KYC verification queue | P1 |
| 59 | Salik import and assignment to bookings | P2 |
| 60 | Traffic fines entry and passthrough | P2 |
| 61 | Damage charges and claims | P2 |
| 62 | Payments, refunds, deposit release | P1 |
| 63 | Invoices with 5% VAT | P1 |
| 64 | Chauffeur roster & shifts | P2 |
| 65 | Rate cards — daily and weekly tiers | P1 |
| 66 | Seasonal and dynamic pricing rules | P2 |
| 67 | Chauffeur packages and transfer routes | P2 |
| 68 | Addons management | P1 |
| 69 | Promo codes | P2 |
| 70 | Branch / location management | P1 |
| 71 | Support tickets | P2 |

### E. Owner portal — 12 screens

| # | Screen | Phase |
|---|---|---|
| 72 | Executive dashboard — revenue, utilisation %, average daily rate, fleet at risk | P1 |
| 73 | Revenue & P&L by branch, class, product | P2 |
| 74 | Fleet ROI — revenue vs cost per vehicle, payback, retire/renew signal | P2 |
| 75 | Utilisation analytics — idle days, peak heatmap | P2 |
| 76 | Booking funnel — source, channel, conversion, abandonment | P3 |
| 77 | Customer analytics — repeat rate, lifetime value, acquisition | P3 |
| 78 | Staff and chauffeur performance | P3 |
| 79 | Expenses and cash flow | P3 |
| 80 | Users & roles | P1 |
| 81 | System settings — company, VAT, branding, policies | P1 |
| 82 | Integrations — gateway keys, SMS, WhatsApp, Tabby | P1 |
| 83 | Audit log | P2 |

### Phase totals

- **P1 — web MVP, self-drive daily/weekly end to end:** 43 screens. Public booking → payment
  → KYC → handover → return → deposit release, plus fleet and operations. A shippable rental
  business on its own.
- **P2 — chauffeur products, lease, charges, pricing depth:** 34 screens.
- **P3 — analytics depth, blog and SEO, expenses:** 6 web screens, plus the entire Expo app
  (which re-implements screens 16–40 as native, and is the bulk of P3's actual effort).

Screen 15 spans P1 and P3 — the About, FAQ and Contact pages ship in P1; the blog ships in P3.

---

## 6. Functional requirements

### FR-1 Search & availability
1. Visitors search by product type, pickup location, return location, and date-time range.
2. Results show only vehicles genuinely available for the full range, excluding vehicles with
   overlapping bookings, active maintenance blocks, or an expired mandatory document.
3. Results are filterable by class, seats, transmission, price band and features, and sortable
   by price and popularity.
4. Each result displays the total price for the selected range, not a per-day teaser alone.
5. Availability is recomputed at checkout; a vehicle taken in the interim surfaces an explicit
   conflict rather than an oversell.

### FR-2 Pricing & quoting
1. A single quote function accepts a booking request and returns an itemised breakdown: base
   rate, weekly or monthly discount, addons, delivery fee, promo discount, 5% VAT, deposit.
2. Weekly tiers apply automatically once the range crosses the tier threshold.
3. Seasonal rate overrides apply by date range and vehicle class.
4. Chauffeur hourly bookings price by package with defined overtime rate.
5. Transfer bookings price by origin zone → destination zone with waiting-time rules.
6. Promo codes validate against product, date range, minimum value and usage limit.
7. The same function runs on server, web and mobile. Server-computed price is authoritative.

### FR-3 Booking lifecycle
1. Bookings follow the state machine in §4; illegal transitions are rejected server-side.
2. Guest checkout is permitted; an account is created on confirmation.
3. Unpaid bookings expire after a configurable window and release the held vehicle.
4. Customers may cancel, with a refund computed from the cancellation policy at booking time.
5. Customers may request an extension; staff approve, and pricing recalculates.
6. Staff create walk-in bookings from the counter with the same engine.

### FR-4 Payments & deposits
1. Online card payments capture the rental amount and place a separate pre-authorisation hold
   for the security deposit.
2. Pay-at-pickup bookings enter a reserved state with no capture, and are subject to a no-show
   policy.
3. Tabby / Tamara instalment payments are supported for eligible booking values.
4. Deposit holds are released automatically after return and charge settlement, or partially
   captured against damages, fines and fees.
5. All gateway interactions are idempotent and reconciled by webhook.
6. Refunds are issued against the original payment method and recorded against the booking.

### FR-5 Customer documents (KYC)
1. Customers upload driving licence plus either Emirates ID (residents) or passport, visa and
   international driving permit (tourists).
2. Each document records an expiry date; expired documents block handover.
3. Staff approve or reject documents with a reason, from a verification queue.
4. A booking cannot reach `READY_FOR_PICKUP` until required documents are verified.
5. Customers are notified of rejection and of upcoming document expiry.

### FR-6 Digital handover & inspection
1. Pickup handover captures a checklist, exterior photos from defined angles, fuel level,
   odometer reading, existing damage marked on a vehicle diagram, and customer e-signature.
2. Return handover presents the pickup record side by side and captures the same fields.
3. New damage detected at return generates a draft charge for staff review.
4. Handover produces a PDF contract stored against the booking and visible to the customer.
5. The same component runs on staff web and the chauffeur mobile app.

### FR-7 Fleet management
1. Vehicles carry class, registration, VIN, colour, mileage, purchase cost and branch.
2. Vehicle documents (mulkiya, insurance, annual inspection) record expiry; a vehicle is
   automatically blocked from booking when a mandatory document expires.
3. Service schedules trigger by mileage or date and create maintenance jobs.
4. A vehicle in an open maintenance job is unavailable for booking.
5. An availability calendar shows every vehicle against dates with booking and block overlays.

### FR-8 Charges — Salik, fines, damage
1. Salik trips are imported and matched to the booking active at each trip timestamp.
2. Traffic fines are recorded against the booking active at the offence timestamp.
3. Each charge type carries a configurable administrative fee.
4. Charges are settled against the deposit hold, or billed to the customer's saved card.
5. Customers see all charges with supporting evidence and may raise a dispute.

### FR-9 Chauffeur dispatch (P2)
1. Chauffeurs have shifts; only on-shift chauffeurs are assignable.
2. Staff assign trips from a dispatch board showing chauffeur availability against trip times.
3. Chauffeurs progress trips through assigned → en route → arrived → in trip → dropped.
4. Airport transfers record a flight number and surface waiting-time rules.
5. Trip start and end capture odometer readings; overtime bills automatically.

### FR-10 Notifications
1. Transactional notifications are delivered by email, SMS and WhatsApp: booking confirmation,
   payment receipt, document status, pickup reminder, return reminder, overdue alert, charge
   raised, deposit released.
2. Staff receive operational alerts: expiring documents, overdue returns, unassigned trips.
3. Templates are editable and support English and Arabic.

### FR-11 Roles & access
1. Four roles with distinct permission sets; staff are scoped to a branch.
2. Staff and owner accounts require TOTP two-factor authentication.
3. All privileged mutations are written to an immutable audit log with actor, before and after.

### FR-12 Mobile app parity (P3)
1. The Expo app consumes the same `/api/v1` endpoints as the website.
2. The customer app covers screens 16–29; the chauffeur app covers 30–40.
3. The handover flow works offline and syncs when connectivity returns, since basement car
   parks and airport levels routinely lose signal.
4. Push notifications mirror the transactional set in FR-10.

---

## 7. Non-functional requirements

### NFR-1 Performance
- Public pages: Largest Contentful Paint under 2.5 s on 4G, Interaction to Next Paint under
  200 ms, Cumulative Layout Shift under 0.1.
- Search results return within 800 ms at the 95th percentile for a 100-vehicle fleet.
- API endpoints respond within 300 ms at the 95th percentile, excluding gateway calls.
- Admin list views paginate server-side; no unbounded queries.

### NFR-2 Availability & recovery
- Target 99.5% monthly uptime for the public site and booking flow.
- Postgres backed up nightly to PBS with a `pg_dump` pre-hook; 30-day retention.
- MinIO replicated to a Hetzner Storage Box weekly.
- Recovery point objective 24 hours, recovery time objective 4 hours.
- Deployments are zero-downtime: new container health-checks before Caddy cuts over.

### NFR-3 Security
- All traffic over TLS; HSTS enabled at Caddy.
- Passwords hashed with Argon2id. Sessions are HTTP-only, secure, SameSite cookies.
- Payment card data never touches our servers — gateway-hosted fields or tokenisation only.
- KYC documents and inspection photos are served through signed, expiring URLs, never public.
- Rate limiting on authentication, OTP and quote endpoints.
- Input validated with Zod at every boundary. Parameterised queries throughout.
- Secrets in environment variables, never committed; rotated on staff departure.
- Dependency scanning in CI; no known-critical vulnerabilities shipped.

### NFR-4 Compliance
- UAE VAT at 5% itemised on every invoice, with sequential invoice numbering.
- Rental agreements retained for the statutory period.
- Customer data handled per UAE Federal Decree-Law 45 of 2021 (PDPL): stated purpose,
  retention limits, and an export and deletion path.
- Data resides on the Hetzner node; no transfer to third-country processors beyond the payment
  gateways and messaging providers named in settings.

### NFR-5 Localisation
- English and Arabic, with full right-to-left layout support for Arabic.
- All dates, times and currency formatted for the Asia/Dubai timezone and AED.
- Timezone handling is explicit: store UTC, render Asia/Dubai.

### NFR-6 Accessibility
- WCAG 2.1 AA for the public site and customer portal.
- Keyboard navigable throughout; visible focus states; semantic landmarks.
- Colour contrast at least 4.5:1 for body text.

### NFR-7 SEO
- Server-rendered public pages with per-page metadata and Open Graph tags.
- Structured data: `Product` and `Offer` for vehicles, `LocalBusiness` for branches.
- Clean, stable URLs; XML sitemap; canonical tags.
- Vehicle and location landing pages are indexable and individually addressable.

### NFR-8 Observability
- Structured JSON logs with request correlation IDs.
- Error tracking with alerting on rate spikes.
- Uptime and certificate expiry monitoring via the existing `monitoring` container.
- Business metrics dashboard: bookings per day, conversion rate, payment failure rate.

### NFR-9 Maintainability
- TypeScript strict mode; no `any` in shared packages.
- Pricing engine, availability engine and state machine covered by unit tests at 90%+.
- Booking, payment and handover flows covered by integration tests.
- Database migrations are versioned and forward-only.
- Files stay focused; a file growing past roughly 300 lines is a signal to split it.

### NFR-10 Scalability
- Stateless web containers; horizontal scaling behind Caddy requires no code change.
- Sessions and queues in Redis, not in process memory.
- Media served from MinIO, not the application container.
- Indexed for the known hot paths: availability by vehicle and date range, bookings by status
  and date, charges by booking.

---

## 8. Build phases

| Phase | Scope | Screens |
|---|---|---|
| **P1** | Web MVP. Self-drive daily and weekly, end to end: search → book → pay → verify → hand over → return → settle → release deposit. Fleet, customers, rate cards, branches, users, settings, executive dashboard. | 43 |
| **P2** | Chauffeur hourly and transfers with dispatch. Monthly lease. Salik, fines and damage charges. Seasonal pricing, promos, maintenance, support tickets, audit log. | 34 |
| **P3** | Analytics depth in the owner portal. Blog and SEO content. Expense tracking. Plus the Expo app for customer and chauffeur, which is the bulk of the phase. | 6 + app |

Each phase gets its own spec, plan and implementation cycle. This document covers the whole
platform; **P1 is the subject of the first implementation plan**.

---

## 9. Open questions

Not blocking phase 1, but needed before the phases that depend on them:

1. **Payment gateway.** Telr, Network International N-Genius, PayTabs and Stripe all support
   auth/capture in the UAE. Selection needed before FR-4 implementation — merchant account
   lead time is typically the long pole.
2. **Salik data source.** Manual CSV import versus an RTA account integration. Affects FR-8
   scope in P2.
3. **Delivery zones and fees.** Whether door delivery is offered at launch, and the zone and
   pricing structure if so.
4. **Insurance products.** Which coverage tiers are sold as addons, and the excess amount for
   each.
5. **Branding.** Logo, palette and typography, required before public site visual design.
