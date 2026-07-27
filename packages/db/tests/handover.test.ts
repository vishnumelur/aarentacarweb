import { describe, it, expect, beforeEach } from 'vitest'
import { sql, eq } from 'drizzle-orm'
import {
  users, customers, branches, vehicleClasses, vehicles, rateCards,
  bookings, handovers, inspectionPhotos, damageMarkers, termsVersions,
} from '../src/schema/index.js'
import { withTestDb } from './db.js'

const db = withTestDb()

async function aBooking() {
  const [user] = await db.insert(users)
    .values({ phone: '+971506666666', role: 'customer', fullName: 'Renter' }).returning()
  const [customer] = await db.insert(customers).values({ userId: user!.id }).returning()
  const [branch] = await db.insert(branches).values({
    name: 'Media City', slug: 'media-city', addressLine: 'Building 10', phone: '+971506943808',
  }).returning()
  const [cls] = await db.insert(vehicleClasses).values({ name: 'Luxury', slug: 'luxury' }).returning()
  const [vehicle] = await db.insert(vehicles).values({
    registration: 'E-33333', classId: cls!.id, branchId: branch!.id,
    make: 'Mercedes-Benz', model: 'S500', year: 2022, colour: 'Black',
    odometerKm: 20000, acquisitionCostFils: 45000000,
  }).returning()
  const [card] = await db.insert(rateCards).values({
    classId: cls!.id, dailyRateFils: 90000, depositFils: 500000,
    includedKmPerDay: 200, excessKmRateFils: 200, validFrom: '2026-01-01',
  }).returning()
  const [booking] = await db.insert(bookings).values({
    reference: 'AA-2026-000010', customerId: customer!.id, product: 'self_drive',
    vehicleId: vehicle!.id, rateCardId: card!.id,
    startsAt: new Date('2026-08-01T08:00:00Z'),
    endsAt: new Date('2026-08-04T08:00:00Z'),
    subtotalFils: 270000, vatFils: 13500, totalFils: 283500, depositFils: 500000,
  }).returning()
  return { booking: booking!, staff: user! }
}

describe('handover schema', () => {
  beforeEach(async () => {
    await db.execute(sql`
      TRUNCATE TABLE inspection_photos, damage_markers, handovers, bookings,
                     rate_cards, vehicles, vehicle_classes, branches, customers, users,
                     terms_versions
      RESTART IDENTITY CASCADE`)
  })

  it('records a pickup handover with fuel, odometer and a signature', async () => {
    const { booking, staff } = await aBooking()
    // termsVersion is a foreign key onto terms_versions.version (FR-22.2) — the row
    // must exist before a handover can pin it.
    await db.insert(termsVersions).values({
      version: 'v1.0', body: 'Rental agreement text v1.0', effectiveFrom: '2026-01-01',
    })
    const [h] = await db.insert(handovers).values({
      bookingId: booking.id, kind: 'pickup', odometerKm: 20000, fuelLevelEighths: 8,
      conductedByUserId: staff.id, signatureObjectKey: 'aa-contracts/sig-1.png',
      signatureIpAddress: '94.200.1.1', termsVersion: 'v1.0',
    }).returning()
    expect(h!.kind).toBe('pickup')
    expect(h!.supersededById).toBeNull()
  })

  it('allows only one active handover per booking and kind', async () => {
    const { booking, staff } = await aBooking()
    const base = {
      bookingId: booking.id, kind: 'pickup' as const, odometerKm: 20000,
      fuelLevelEighths: 8, conductedByUserId: staff.id,
    }
    await db.insert(handovers).values(base)
    await expect(db.insert(handovers).values(base)).rejects.toThrow(/handover_active_unique/)
  })

  it('rejects a fuel level outside 0 to 8 eighths', async () => {
    const { booking, staff } = await aBooking()
    await expect(db.insert(handovers).values({
      bookingId: booking.id, kind: 'return', odometerKm: 20500,
      fuelLevelEighths: 9, conductedByUserId: staff.id,
    })).rejects.toThrow(/fuel_eighths_range/)
  })

  it('defaults the capture timestamp server-side', async () => {
    const { booking, staff } = await aBooking()
    const [h] = await db.insert(handovers).values({
      bookingId: booking.id, kind: 'pickup', odometerKm: 20000,
      fuelLevelEighths: 8, conductedByUserId: staff.id,
    }).returning()
    const before = new Date()
    const [photo] = await db.insert(inspectionPhotos).values({
      handoverId: h!.id, objectKey: 'aa-inspections/front-left.jpg',
      angle: 'front_left', uploadedByUserId: staff.id,
    }).returning()
    expect(photo!.capturedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 5000)
  })

  it('records damage markers positioned on the vehicle diagram', async () => {
    const { booking, staff } = await aBooking()
    const [h] = await db.insert(handovers).values({
      bookingId: booking.id, kind: 'return', odometerKm: 20800,
      fuelLevelEighths: 4, conductedByUserId: staff.id,
    }).returning()
    const [marker] = await db.insert(damageMarkers).values({
      handoverId: h!.id, panel: 'front_bumper', xPercent: 42, yPercent: 71,
      severity: 'scratch', notes: 'Light scuff, 5cm',
    }).returning()
    expect(marker!.panel).toBe('front_bumper')
  })

  it('refuses to delete a handover — evidence is superseded, never removed (NFR-11)', async () => {
    const { booking, staff } = await aBooking()
    const [h] = await db.insert(handovers).values({
      bookingId: booking.id, kind: 'pickup', odometerKm: 20000,
      fuelLevelEighths: 8, conductedByUserId: staff.id,
    }).returning()
    await expect(db.delete(handovers).where(eq(handovers.id, h!.id)))
      .rejects.toThrow(/handovers are append-only: supersede the record, never delete it/)
  })

  it('refuses to edit a handover in place (NFR-11)', async () => {
    const { booking, staff } = await aBooking()
    const [h] = await db.insert(handovers).values({
      bookingId: booking.id, kind: 'pickup', odometerKm: 20000,
      fuelLevelEighths: 8, conductedByUserId: staff.id,
    }).returning()
    await expect(
      db.update(handovers).set({ odometerKm: 99999 }).where(eq(handovers.id, h!.id)),
    ).rejects.toThrow(/handovers are append-only: only superseded_by_id may change/)
  })

  it('supports the supersede workflow within one transaction (NFR-11)', async () => {
    const { booking, staff } = await aBooking()
    const [original] = await db.insert(handovers).values({
      bookingId: booking.id, kind: 'pickup', odometerKm: 20000,
      fuelLevelEighths: 8, conductedByUserId: staff.id,
    }).returning()

    const replacementId = crypto.randomUUID()
    await db.transaction(async (tx) => {
      // Mark the original superseded FIRST — the partial unique index permits only one
      // active record per (booking, kind), and the deferrable FK tolerates the forward
      // reference until commit.
      await tx.update(handovers)
        .set({ supersededById: replacementId })
        .where(eq(handovers.id, original!.id))
      await tx.insert(handovers).values({
        id: replacementId, bookingId: booking.id, kind: 'pickup',
        odometerKm: 20050, fuelLevelEighths: 7, conductedByUserId: staff.id,
      })
    })

    const all = await db.select().from(handovers).where(eq(handovers.bookingId, booking.id))
    expect(all).toHaveLength(2)
    const active = all.filter((h) => h.supersededById === null)
    expect(active).toHaveLength(1)
    expect(active[0]!.odometerKm).toBe(20050)
    // The original survives unaltered — that is the point.
    const superseded = all.find((h) => h.id === original!.id)
    expect(superseded!.odometerKm).toBe(20000)
    expect(superseded!.supersededById).toBe(replacementId)
  })

  it('refuses a supersededById pointing at a handover that does not exist (NFR-11)', async () => {
    const { booking, staff } = await aBooking()
    const [h] = await db.insert(handovers).values({
      bookingId: booking.id, kind: 'return', odometerKm: 21000,
      fuelLevelEighths: 4, conductedByUserId: staff.id,
    }).returning()
    await expect(
      db.update(handovers)
        .set({ supersededById: crypto.randomUUID() })
        .where(eq(handovers.id, h!.id)),
    ).rejects.toThrow(/handovers_superseded_by_id_fk/)
  })

  it('overrides a client-supplied capture timestamp with the server clock (NFR-11)', async () => {
    const { booking, staff } = await aBooking()
    const [h] = await db.insert(handovers).values({
      bookingId: booking.id, kind: 'pickup', odometerKm: 20000,
      fuelLevelEighths: 8, conductedByUserId: staff.id,
    }).returning()
    const backdated = new Date('2020-01-01T00:00:00Z')
    const [photo] = await db.insert(inspectionPhotos).values({
      handoverId: h!.id, objectKey: 'aa-inspections/rear.jpg',
      angle: 'rear', uploadedByUserId: staff.id,
      capturedAt: backdated,
    }).returning()
    // A client claiming 2020 must not be believed.
    expect(photo!.capturedAt.getFullYear()).toBeGreaterThan(2020)
  })

  it('refuses to alter or delete an inspection photograph (NFR-11)', async () => {
    const { booking, staff } = await aBooking()
    const [h] = await db.insert(handovers).values({
      bookingId: booking.id, kind: 'pickup', odometerKm: 20000,
      fuelLevelEighths: 8, conductedByUserId: staff.id,
    }).returning()
    const [photo] = await db.insert(inspectionPhotos).values({
      handoverId: h!.id, objectKey: 'aa-inspections/front.jpg',
      angle: 'front', uploadedByUserId: staff.id,
    }).returning()
    await expect(
      db.update(inspectionPhotos).set({ objectKey: 'tampered.jpg' })
        .where(eq(inspectionPhotos.id, photo!.id)),
    ).rejects.toThrow(/immutable evidence/)
    await expect(
      db.delete(inspectionPhotos).where(eq(inspectionPhotos.id, photo!.id)),
    ).rejects.toThrow(/immutable evidence/)
  })
})
