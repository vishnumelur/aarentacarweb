# AA Rent A Car

Dubai car rental platform — public booking site plus customer, chauffeur, manager and owner
portals, sharing one database with a React Native / Expo mobile app.

**Status:** design complete, implementation not started.

## Start here

[`docs/superpowers/specs/2026-07-27-aa-rentacar-design.md`](docs/superpowers/specs/2026-07-27-aa-rentacar-design.md)

That document is the source of truth: architecture, server sizing, domain model, all 83
screens, functional requirements, non-functional requirements and build phases.

## Planned structure

```
apps/web/        Next.js 16 App Router — public site + 4 portals + /api/v1
apps/mobile/     Expo (React Native) — customer app + chauffeur app
apps/worker/     BullMQ consumer — Salik sync, deposit release, alerts, PDFs
packages/db/     Drizzle schema + migrations
packages/shared/ Zod schemas, pricing engine, booking state machine
packages/ui/     Design tokens and shared primitives
```

## Deployment target

Self-hosted on the Hetzner-PVE Proxmox cluster behind the existing Caddy container.
Requirement: **~6 cores, 16 GB RAM, 350 GB NVMe** in addition to existing workloads.
See §3 of the spec for the container layout.

Images are built in GitHub Actions and pulled on the node. Do not run `next build` on the
production host — it will OOM neighbouring containers.

## Build order

1. **P1** — self-drive daily/weekly end to end (43 screens)
2. **P2** — chauffeur, lease, charges, pricing depth (34 screens)
3. **P3** — analytics and SEO content (6 screens), plus the Expo app
