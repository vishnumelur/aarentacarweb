import { describe, it, expect, beforeEach } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { settings, contentPages, termsVersions } from '../src/schema/index.js'
import { withTestDb } from './db.js'

const db = withTestDb()

describe('settings and content schema', () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE terms_versions, content_pages, settings RESTART IDENTITY CASCADE`)
  })

  it('stores VAT as basis points so it is never hardcoded in a query', async () => {
    await db.insert(settings).values({ key: 'vat_bps', value: 500 })
    const [row] = await db.select().from(settings).where(eq(settings.key, 'vat_bps'))
    expect(row!.value).toBe(500)
  })

  it('stores integration credentials flagged as secret', async () => {
    const [row] = await db.insert(settings)
      .values({ key: 'gateway_api_key', value: 'encrypted-blob', isSecret: true })
      .returning()
    expect(row!.isSecret).toBe(true)
  })

  it('rejects a duplicate setting key', async () => {
    await db.insert(settings).values({ key: 'company_trn', value: '100123456700003' })
    await expect(db.insert(settings).values({ key: 'company_trn', value: 'other' })).rejects.toThrow()
  })

  it('stores an editable legal page', async () => {
    const [page] = await db.insert(contentPages).values({
      slug: 'cancellation-policy', title: 'Cancellation Policy',
      body: 'Free cancellation up to 24 hours before pickup.', isLegal: true,
    }).returning()
    expect(page!.isLegal).toBe(true)
  })

  it('versions the rental agreement so a contract can be reproduced as accepted (FR-22.2)', async () => {
    await db.insert(termsVersions).values({
      version: 'v1.0', body: 'Rental agreement text v1.0', effectiveFrom: '2026-01-01',
    })
    await db.insert(termsVersions).values({
      version: 'v1.1', body: 'Rental agreement text v1.1', effectiveFrom: '2026-06-01',
    })
    const rows = await db.select().from(termsVersions)
    expect(rows).toHaveLength(2)
  })

  it('rejects a duplicate terms version', async () => {
    await db.insert(termsVersions).values({ version: 'v2.0', body: 'x', effectiveFrom: '2026-01-01' })
    await expect(
      db.insert(termsVersions).values({ version: 'v2.0', body: 'y', effectiveFrom: '2026-02-01' }),
    ).rejects.toThrow()
  })
})
