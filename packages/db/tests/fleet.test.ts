import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { branches, branchHours, vehicleClasses, vehicles, vehicleDocuments } from '../src/schema/index.js'
import { withTestDb } from './db.js'

const db = withTestDb()

async function seedClass() {
  const [cls] = await db.insert(vehicleClasses)
    .values({ name: 'Economy', slug: 'economy', displayOrder: 1 }).returning()
  return cls!
}

async function seedBranch() {
  const [branch] = await db.insert(branches).values({
    name: 'Al Karama',
    slug: 'al-karama',
    addressLine: 'Khalifa bin Zayed Street, near ADCB Metro Station Exit 1',
    city: 'Dubai',
    phone: '+971503377877',
  }).returning()
  return branch!
}

describe('fleet schema', () => {
  beforeEach(async () => {
    await db.execute(sql`
      TRUNCATE TABLE vehicle_documents, vehicle_photos, maintenance_jobs,
                     vehicles, vehicle_classes, branch_hours, branches
      RESTART IDENTITY CASCADE`)
  })

  it('stores vehicle classes as data, not as an enum', async () => {
    const cls = await seedClass()
    expect(cls.slug).toBe('economy')
  })

  it('models Friday as two opening intervals on the same weekday', async () => {
    const branch = await seedBranch()
    await db.insert(branchHours).values([
      { branchId: branch.id, weekday: 5, opensAt: '08:30', closesAt: '12:00' },
      { branchId: branch.id, weekday: 5, opensAt: '17:00', closesAt: '21:30' },
    ])
    const rows = await db.select().from(branchHours)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.weekday === 5)).toBe(true)
  })

  it('rejects an interval that closes before it opens', async () => {
    const branch = await seedBranch()
    await expect(
      db.insert(branchHours).values({ branchId: branch.id, weekday: 1, opensAt: '21:00', closesAt: '08:00' }),
    ).rejects.toThrow()
  })

  it('stores a vehicle with a unique registration and defaults to available', async () => {
    const branch = await seedBranch()
    const cls = await seedClass()
    const [vehicle] = await db.insert(vehicles).values({
      registration: 'A-12345',
      classId: cls.id,
      branchId: branch.id,
      make: 'Nissan',
      model: 'Sunny',
      year: 2023,
      colour: 'White',
      odometerKm: 15000,
      acquisitionCostFils: 5500000,
    }).returning()
    expect(vehicle!.status).toBe('available')
  })

  it('rejects a duplicate registration', async () => {
    const branch = await seedBranch()
    const cls = await seedClass()
    const base = {
      classId: cls.id, branchId: branch.id, make: 'Toyota', model: 'Corolla',
      year: 2023, colour: 'Silver', odometerKm: 1000, acquisitionCostFils: 7000000,
    }
    await db.insert(vehicles).values({ ...base, registration: 'B-99999' })
    await expect(db.insert(vehicles).values({ ...base, registration: 'B-99999' })).rejects.toThrow()
  })

  it('records vehicle documents with expiry so a vehicle can be auto-blocked', async () => {
    const branch = await seedBranch()
    const cls = await seedClass()
    const [vehicle] = await db.insert(vehicles).values({
      registration: 'C-11111', classId: cls.id, branchId: branch.id,
      make: 'MG', model: '5', year: 2023, colour: 'Grey',
      odometerKm: 500, acquisitionCostFils: 6000000,
    }).returning()
    const [doc] = await db.insert(vehicleDocuments).values({
      vehicleId: vehicle!.id, type: 'mulkiya', expiresOn: '2027-06-30',
    }).returning()
    expect(doc!.type).toBe('mulkiya')
  })
})
