import { describe, it, expect, beforeAll } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { seed } from '../src/seed.js'
import {
  branches, branchHours, vehicleClasses, vehicles, rateCards, users, customers, addons,
  settings, contentPages, termsVersions,
} from '../src/schema/index.js'
import { withTestDb } from './db.js'

const db = withTestDb()

describe('seed script', () => {
  beforeAll(async () => {
    await db.execute(sql`
      TRUNCATE TABLE invoices, charges, deposit_holds, payments,
                     inspection_photos, damage_markers, handovers,
                     booking_addons, self_drive_details, bookings,
                     promo_codes, addons, seasonal_rates, weekly_tiers, rate_cards,
                     vehicle_documents, vehicle_photos, maintenance_jobs, vehicles,
                     vehicle_classes, branch_hours, branches,
                     customer_documents, customers, sessions, audit_log, users,
                     terms_versions, content_pages, settings
      RESTART IDENTITY CASCADE`)
    await seed(db)
  })

  it('creates both real branches', async () => {
    const rows = await db.select().from(branches)
    expect(rows.map((b) => b.slug).sort()).toEqual(['al-karama', 'dubai-media-city'])
  })

  it('gives Friday two opening intervals and other days one', async () => {
    const [branch] = await db.select().from(branches).where(eq(branches.slug, 'al-karama'))
    const hours = await db.select().from(branchHours).where(eq(branchHours.branchId, branch!.id))
    const friday = hours.filter((h) => h.weekday === 5)
    const saturday = hours.filter((h) => h.weekday === 6)
    expect(friday).toHaveLength(2)
    expect(saturday).toHaveLength(1)
  })

  it('creates the seven vehicle classes from the existing site', async () => {
    const rows = await db.select().from(vehicleClasses)
    expect(rows.map((c) => c.slug).sort()).toEqual(
      ['compact', 'economy', 'family', 'limousine', 'luxury', 'medium', 'sports'],
    )
  })

  it('gives every class an active rate card', async () => {
    const classes = await db.select().from(vehicleClasses)
    const cards = await db.select().from(rateCards)
    expect(cards).toHaveLength(classes.length)
  })

  it('creates one test account per role', async () => {
    const rows = await db.select().from(users)
    const roles = new Set(rows.map((u) => u.role))
    expect(roles).toEqual(new Set(['customer', 'chauffeur', 'staff', 'owner']))
  })

  it('creates sample vehicles and addons', async () => {
    expect((await db.select().from(vehicles)).length).toBeGreaterThanOrEqual(6)
    expect((await db.select().from(addons)).length).toBeGreaterThanOrEqual(4)
  })

  it('seeds VAT at 5% as basis points', async () => {
    const [row] = await db.select().from(settings).where(eq(settings.key, 'vat_bps'))
    expect(row!.value).toBe(500)
  })

  it('seeds the five legal pages and a v1.0 rental agreement', async () => {
    const pages = await db.select().from(contentPages)
    expect(pages.map((p) => p.slug).sort()).toEqual([
      'cancellation-policy', 'insurance-liability', 'privacy', 'rental-agreement', 'terms',
    ])
    const terms = await db.select().from(termsVersions)
    expect(terms.map((t) => t.version)).toContain('v1.0')
  })

  it('is idempotent — running twice does not duplicate branches or settings', async () => {
    await seed(db)
    expect(await db.select().from(branches)).toHaveLength(2)
    expect(await db.select().from(contentPages)).toHaveLength(5)
  })

  // Every table the seed writes, not just the two the brief's test checks above.
  // branch_hours in particular has no natural place in that test but is exactly
  // the table whose onConflictDoNothing() silently did nothing without an explicit
  // target — a bare re-run doubled it from 16 rows to 32 and nothing caught it.
  it('is fully idempotent — a second run changes no row count', async () => {
    const tables = {
      branches, branchHours, vehicleClasses, rateCards, vehicles,
      addons, users, customers, termsVersions, contentPages, settings,
    }
    const countAll = async () => {
      const out: Record<string, number> = {}
      for (const [name, table] of Object.entries(tables)) {
        out[name] = (await db.select().from(table)).length
      }
      return out
    }
    const before = await countAll()
    await seed(db)
    const after = await countAll()
    expect(after).toEqual(before)
  })
})
