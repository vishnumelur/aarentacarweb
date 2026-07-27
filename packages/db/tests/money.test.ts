import { describe, it, expect, beforeEach } from 'vitest'
import { sql, eq } from 'drizzle-orm'
import {
  users, customers, branches, vehicleClasses, vehicles, rateCards,
  bookings, payments, depositHolds, charges, invoices,
} from '../src/schema/index.js'
import { withTestDb } from './db.js'

const db = withTestDb()

async function aBooking() {
  const [user] = await db.insert(users)
    .values({ phone: '+971507777777', role: 'customer', fullName: 'Payer' }).returning()
  const [customer] = await db.insert(customers).values({ userId: user!.id }).returning()
  const [branch] = await db.insert(branches).values({
    name: 'Al Karama', slug: 'al-karama', addressLine: 'Khalifa bin Zayed', phone: '+971503377877',
  }).returning()
  const [cls] = await db.insert(vehicleClasses).values({ name: 'Medium', slug: 'medium' }).returning()
  const [vehicle] = await db.insert(vehicles).values({
    registration: 'F-44444', classId: cls!.id, branchId: branch!.id,
    make: 'Toyota', model: 'Corolla', year: 2023, colour: 'Silver',
    odometerKm: 10000, acquisitionCostFils: 8000000,
  }).returning()
  const [card] = await db.insert(rateCards).values({
    classId: cls!.id, dailyRateFils: 18000, depositFils: 150000,
    includedKmPerDay: 250, excessKmRateFils: 60, validFrom: '2026-01-01',
  }).returning()
  const [booking] = await db.insert(bookings).values({
    reference: 'AA-2026-000020', customerId: customer!.id, product: 'self_drive',
    vehicleId: vehicle!.id, rateCardId: card!.id,
    startsAt: new Date('2026-08-01T08:00:00Z'),
    endsAt: new Date('2026-08-03T08:00:00Z'),
    subtotalFils: 36000, vatFils: 1800, totalFils: 37800, depositFils: 150000,
  }).returning()
  return { booking: booking!, customer: customer! }
}

describe('money schema', () => {
  beforeEach(async () => {
    await db.execute(sql`
      TRUNCATE TABLE invoices, charges, deposit_holds, payments, bookings,
                     rate_cards, vehicles, vehicle_classes, branches, customers, users
      RESTART IDENTITY CASCADE`)
    // invoice numbering now lives in invoice_sequence, not a Postgres identity
    // sequence, so RESTART IDENTITY above no longer resets it. Reset the counter
    // directly, but never truncate invoice_sequence itself — its single seed row
    // (id = 1) must survive, per the invoice_sequence_single_row CHECK.
    await db.execute(sql`UPDATE invoice_sequence SET next_number = 1`)
  })

  it('records a card payment with a gateway reference', async () => {
    const { booking } = await aBooking()
    const [p] = await db.insert(payments).values({
      bookingId: booking.id, method: 'card', amountFils: 37800,
      gatewayReference: 'telr-txn-abc123',
    }).returning()
    expect(p!.status).toBe('pending')
  })

  it('enforces gateway idempotency by rejecting a duplicate reference (FR-4.5)', async () => {
    const { booking } = await aBooking()
    const base = { bookingId: booking.id, method: 'card' as const, amountFils: 37800 }
    await db.insert(payments).values({ ...base, gatewayReference: 'telr-dup-1' })
    await expect(db.insert(payments).values({ ...base, gatewayReference: 'telr-dup-1' })).rejects.toThrow()
  })

  it('tracks a deposit hold through to release', async () => {
    const { booking } = await aBooking()
    const [hold] = await db.insert(depositHolds).values({
      bookingId: booking.id, amountFils: 150000, gatewayReference: 'telr-auth-1',
    }).returning()
    expect(hold!.status).toBe('held')
    expect(hold!.capturedFils).toBe(0)
  })

  it('rejects capturing more than the held amount', async () => {
    const { booking } = await aBooking()
    await expect(db.insert(depositHolds).values({
      bookingId: booking.id, amountFils: 150000, capturedFils: 200000,
      gatewayReference: 'telr-auth-2',
    })).rejects.toThrow()
  })

  it('records a charge with a separate admin fee (FR-8.3)', async () => {
    const { booking } = await aBooking()
    const [charge] = await db.insert(charges).values({
      bookingId: booking.id, type: 'salik', amountFils: 400, adminFeeFils: 500,
      description: 'Salik crossing 2026-08-02 14:22',
    }).returning()
    expect(charge!.adminFeeFils).toBe(500)
    expect(charge!.isDisputed).toBe(false)
  })

  it('issues gapless sequential invoice numbers (FR-15.2)', async () => {
    const { booking, customer } = await aBooking()
    const [a] = await db.insert(invoices).values({
      bookingId: booking.id, customerId: customer.id,
      subtotalFils: 36000, vatFils: 1800, totalFils: 37800,
    }).returning()
    const [b] = await db.insert(invoices).values({
      bookingId: booking.id, customerId: customer.id,
      subtotalFils: 1000, vatFils: 50, totalFils: 1050,
    }).returning()
    expect(b!.number).toBe(a!.number + 1)
  })

  it('keeps a voided invoice number rather than deleting it (FR-15.2)', async () => {
    const { booking, customer } = await aBooking()
    const [inv] = await db.insert(invoices).values({
      bookingId: booking.id, customerId: customer.id,
      subtotalFils: 36000, vatFils: 1800, totalFils: 37800,
    }).returning()
    const [voided] = await db.update(invoices)
      .set({ status: 'void', voidReason: 'Issued in error' })
      .where(sql`id = ${inv!.id}`).returning()
    expect(voided!.number).toBe(inv!.number)
    expect(voided!.status).toBe('void')
  })

  it('leaves no gap when an invoice insert is rolled back (FR-15.2)', async () => {
    const { booking, customer } = await aBooking()
    const [first] = await db.insert(invoices).values({
      bookingId: booking.id, customerId: customer.id,
      subtotalFils: 36000, vatFils: 1800, totalFils: 37800,
    }).returning()

    // A failed invoice creation must not consume a number.
    await expect(db.transaction(async (tx) => {
      await tx.insert(invoices).values({
        bookingId: booking.id, customerId: customer.id,
        subtotalFils: 1000, vatFils: 50, totalFils: 1050,
      })
      throw new Error('simulated failure after allocating a number')
    })).rejects.toThrow()

    const [next] = await db.insert(invoices).values({
      bookingId: booking.id, customerId: customer.id,
      subtotalFils: 2000, vatFils: 100, totalFils: 2100,
    }).returning()

    // With a sequence this would be first.number + 2. It must be + 1.
    expect(next!.number).toBe(first!.number + 1)
  })

  it('refuses to delete an invoice — void it instead (FR-15.2)', async () => {
    const { booking, customer } = await aBooking()
    const [inv] = await db.insert(invoices).values({
      bookingId: booking.id, customerId: customer.id,
      subtotalFils: 36000, vatFils: 1800, totalFils: 37800,
    }).returning()
    await expect(db.delete(invoices).where(eq(invoices.id, inv!.id))).rejects.toThrow()
  })

  it('requires a reason when voiding an invoice (FR-15.2)', async () => {
    const { booking, customer } = await aBooking()
    const [inv] = await db.insert(invoices).values({
      bookingId: booking.id, customerId: customer.id,
      subtotalFils: 36000, vatFils: 1800, totalFils: 37800,
    }).returning()
    await expect(
      db.update(invoices).set({ status: 'void' }).where(eq(invoices.id, inv!.id)),
    ).rejects.toThrow()
  })

  it('refuses a credit note pointing at an invoice that does not exist', async () => {
    const { booking, customer } = await aBooking()
    await expect(db.insert(invoices).values({
      bookingId: booking.id, customerId: customer.id,
      subtotalFils: 1000, vatFils: 50, totalFils: 1050,
      creditsInvoiceId: crypto.randomUUID(),
    })).rejects.toThrow()
  })

  it('rejects a payment amount of zero or less', async () => {
    const { booking } = await aBooking()
    await expect(db.insert(payments).values({
      bookingId: booking.id, method: 'card', amountFils: 0,
      gatewayReference: 'telr-zero-1',
    })).rejects.toThrow()
  })

  it('rejects a refund larger than the payment', async () => {
    const { booking } = await aBooking()
    await expect(db.insert(payments).values({
      bookingId: booking.id, method: 'card', amountFils: 10000,
      refundedFils: 20000, gatewayReference: 'telr-overrefund-1',
    })).rejects.toThrow()
  })
})
