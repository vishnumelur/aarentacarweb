import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { config } from 'dotenv'
import { and, eq, isNull } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { createDb } from './client.js'
import * as s from './schema/index.js'

config({ path: resolve(import.meta.dirname, '../../../.env') })

type Db = NodePgDatabase<typeof s>

// weekday: 0 = Sunday ... 6 = Saturday
// Sat-Thu 08:00-21:30; Fri 08:30-12:00 and 17:00-21:30
const WEEKLY_HOURS: Array<{ weekday: number; opensAt: string; closesAt: string }> = [
  { weekday: 0, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 1, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 2, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 3, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 4, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 5, opensAt: '08:30', closesAt: '12:00' },
  { weekday: 5, opensAt: '17:00', closesAt: '21:30' },
  { weekday: 6, opensAt: '08:00', closesAt: '21:30' },
]

const CLASSES = [
  { name: 'Economy',   slug: 'economy',   displayOrder: 1, dailyRateFils: 12000, depositFils: 100000, includedKmPerDay: 250, excessKmRateFils: 50 },
  { name: 'Compact',   slug: 'compact',   displayOrder: 2, dailyRateFils: 15000, depositFils: 100000, includedKmPerDay: 250, excessKmRateFils: 50 },
  { name: 'Medium',    slug: 'medium',    displayOrder: 3, dailyRateFils: 18000, depositFils: 150000, includedKmPerDay: 250, excessKmRateFils: 60 },
  { name: 'Family',    slug: 'family',    displayOrder: 4, dailyRateFils: 25000, depositFils: 150000, includedKmPerDay: 250, excessKmRateFils: 70 },
  { name: 'Luxury',    slug: 'luxury',    displayOrder: 5, dailyRateFils: 90000, depositFils: 500000, includedKmPerDay: 200, excessKmRateFils: 200 },
  { name: 'Sports',    slug: 'sports',    displayOrder: 6, dailyRateFils: 150000, depositFils: 800000, includedKmPerDay: 150, excessKmRateFils: 300 },
  { name: 'Limousine', slug: 'limousine', displayOrder: 7, dailyRateFils: 120000, depositFils: 500000, includedKmPerDay: 200, excessKmRateFils: 250 },
]

export async function seed(db: Db): Promise<void> {
  // Branches — real addresses and hours from the existing business
  const branchRows = await db.insert(s.branches).values([
    {
      name: 'Al Karama', slug: 'al-karama',
      addressLine: 'Khalifa bin Zayed Street, near ADCB Metro Station Exit 1, Al Karama',
      city: 'Dubai', phone: '+971503377877',
    },
    {
      name: 'Dubai Media City', slug: 'dubai-media-city',
      addressLine: 'Ground floor, Building 10 (BCC World News Building), Dubai Media City',
      city: 'Dubai', phone: '+971506943808',
    },
  ]).onConflictDoNothing({ target: s.branches.slug }).returning()

  const branches = branchRows.length > 0 ? branchRows : await db.select().from(s.branches)

  for (const branch of branches) {
    await db.insert(s.branchHours)
      .values(WEEKLY_HOURS.map((h) => ({ ...h, branchId: branch.id })))
      .onConflictDoNothing()
  }

  // Vehicle classes and one rate card each
  const classRows = await db.insert(s.vehicleClasses)
    .values(CLASSES.map(({ name, slug, displayOrder }) => ({ name, slug, displayOrder })))
    .onConflictDoNothing({ target: s.vehicleClasses.slug }).returning()

  const classes = classRows.length > 0 ? classRows : await db.select().from(s.vehicleClasses)
  const bySlug = new Map(classes.map((c) => [c.slug, c]))

  // rate_cards_one_current_per_class permits at most one open-ended (validTo IS NULL)
  // card per class. Checked per class, not once for the whole table: a global
  // "table is empty" guard would skip every class forever the moment even one class
  // already had a card, which is exactly the state a rerun leaves behind.
  for (const c of CLASSES) {
    const classId = bySlug.get(c.slug)!.id
    const [existingCurrent] = await db.select().from(s.rateCards)
      .where(and(eq(s.rateCards.classId, classId), isNull(s.rateCards.validTo)))
    if (!existingCurrent) {
      await db.insert(s.rateCards).values({
        classId,
        dailyRateFils: c.dailyRateFils,
        depositFils: c.depositFils,
        includedKmPerDay: c.includedKmPerDay,
        excessKmRateFils: c.excessKmRateFils,
        validFrom: '2026-01-01',
      })
    }
  }

  // Sample fleet
  const alKarama = branches.find((b) => b.slug === 'al-karama')!
  const mediaCity = branches.find((b) => b.slug === 'dubai-media-city')!

  await db.insert(s.vehicles).values([
    { registration: 'A-10001', classId: bySlug.get('economy')!.id,   branchId: alKarama.id, make: 'Nissan',        model: 'Sunny',   year: 2023, colour: 'White',  seats: 5, odometerKm: 21000, acquisitionCostFils: 5500000 },
    { registration: 'A-10002', classId: bySlug.get('compact')!.id,   branchId: alKarama.id, make: 'Hyundai',       model: 'Accent',  year: 2021, colour: 'Silver', seats: 5, odometerKm: 48000, acquisitionCostFils: 4800000 },
    { registration: 'A-10003', classId: bySlug.get('medium')!.id,    branchId: alKarama.id, make: 'Toyota',        model: 'Corolla', year: 2023, colour: 'Grey',   seats: 5, odometerKm: 12000, acquisitionCostFils: 8000000 },
    { registration: 'B-20001', classId: bySlug.get('family')!.id,    branchId: mediaCity.id, make: 'Chevrolet',    model: 'Tahoe',   year: 2022, colour: 'Black',  seats: 7, odometerKm: 33000, acquisitionCostFils: 22000000 },
    { registration: 'B-20002', classId: bySlug.get('luxury')!.id,    branchId: mediaCity.id, make: 'Mercedes-Benz', model: 'S500',   year: 2022, colour: 'Black',  seats: 5, odometerKm: 19000, acquisitionCostFils: 45000000 },
    { registration: 'B-20003', classId: bySlug.get('sports')!.id,    branchId: mediaCity.id, make: 'Mercedes-Benz', model: 'G63 AMG', year: 2022, colour: 'White', seats: 5, odometerKm: 15000, acquisitionCostFils: 90000000 },
  ]).onConflictDoNothing({ target: s.vehicles.registration })

  // Addons
  await db.insert(s.addons).values([
    { name: 'Additional driver', slug: 'additional-driver', priceFils: 5000, priceModel: 'per_booking' },
    { name: 'Child seat',        slug: 'child-seat',        priceFils: 3000, priceModel: 'per_day', stockLimit: 12 },
    { name: 'GPS navigation',    slug: 'gps',               priceFils: 2000, priceModel: 'per_day', stockLimit: 20 },
    { name: 'Unlimited mileage', slug: 'unlimited-mileage', priceFils: 8000, priceModel: 'per_day' },
  ]).onConflictDoNothing({ target: s.addons.slug })

  // One test account per role. Passwords are set by the auth plan (P1.3);
  // these rows exist so later plans have something to log in as.
  await db.insert(s.users).values([
    { phone: '+971500000001', fullName: 'Test Customer',  role: 'customer' },
    { phone: '+971500000002', fullName: 'Test Chauffeur', role: 'chauffeur', branchId: alKarama.id },
    { phone: '+971500000003', fullName: 'Test Staff',     role: 'staff',     branchId: alKarama.id },
    { phone: '+971500000004', fullName: 'Test Owner',     role: 'owner' },
  ]).onConflictDoNothing({ target: s.users.phone })

  const [customerUser] = await db.select().from(s.users)
    .where(eq(s.users.phone, '+971500000001'))
  if (customerUser) {
    await db.insert(s.customers).values({ userId: customerUser.id })
      .onConflictDoNothing({ target: s.customers.userId })
  }

  // Baseline settings. VAT is 5% expressed in basis points — never hardcoded.
  await db.insert(s.settings).values([
    { key: 'vat_bps', value: 500 },
    { key: 'company_name', value: 'Auto Assist Service' },
    { key: 'company_trading_name', value: 'AA Rentals' },
    { key: 'company_trn', value: '' },
    { key: 'currency', value: 'AED' },
    { key: 'cancellation_free_hours', value: 24 },
    { key: 'no_show_grace_minutes', value: 120 },
    { key: 'booking_hold_minutes', value: 30 },
    { key: 'minimum_driver_age', value: 21 },
    { key: 'minimum_licence_months', value: 6 },
  ]).onConflictDoNothing({ target: s.settings.key })

  // FR-22.2 — the agreement bookings pin by version. Seeded before anything that
  // could reference it: bookings.termsVersion and handovers.termsVersion are foreign
  // keys into this table.
  await db.insert(s.termsVersions).values({
    version: 'v1.0',
    body: 'Rental agreement v1.0. Replace with the reviewed legal text before launch.',
    effectiveFrom: '2026-01-01',
  }).onConflictDoNothing({ target: s.termsVersions.version })

  // FR-22.1 — the five legal pages, editable without a deployment
  await db.insert(s.contentPages).values([
    { slug: 'terms',               title: 'Terms and Conditions',   body: 'Placeholder — replace before launch.', isLegal: true },
    { slug: 'privacy',             title: 'Privacy Policy',         body: 'Placeholder — replace before launch.', isLegal: true },
    { slug: 'rental-agreement',    title: 'Rental Agreement',       body: 'Placeholder — replace before launch.', isLegal: true },
    { slug: 'insurance-liability', title: 'Insurance and Liability', body: 'Placeholder — replace before launch.', isLegal: true },
    { slug: 'cancellation-policy', title: 'Cancellation Policy',    body: 'Placeholder — replace before launch.', isLegal: true },
  ]).onConflictDoNothing({ target: s.contentPages.slug })
}

// CLI entrypoint. Compared as file URLs (via pathToFileURL) rather than string-
// concatenating `file://${process.argv[1]}` — the latter breaks the moment the
// invoked path isn't already a clean absolute POSIX path (e.g. contains characters
// that need URL-encoding, or a drive letter on Windows).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  await seed(createDb(url))
  console.log('Seed complete.')
  process.exit(0)
}
