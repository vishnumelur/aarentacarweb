import {
  pgTable, pgEnum, uuid, text, integer, boolean, date, time, timestamp,
  numeric, check, index, unique,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from './identity'

export const vehicleStatus = pgEnum('vehicle_status', [
  'available', 'rented', 'maintenance', 'retired',
])
export const vehicleDocumentType = pgEnum('vehicle_document_type', [
  'mulkiya', 'insurance', 'inspection',
])
export const maintenanceStatus = pgEnum('maintenance_status', ['open', 'in_progress', 'closed'])

export const branches = pgTable('branches', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  addressLine: text('address_line').notNull(),
  city: text('city').notNull().default('Dubai'),
  phone: text('phone').notNull(),
  latitude: numeric('latitude', { precision: 10, scale: 7 }),
  longitude: numeric('longitude', { precision: 10, scale: 7 }),
  deliveryFeeFils: integer('delivery_fee_fils').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// NFR-5 — a list of intervals per weekday. Friday has two rows.
// weekday: 0 = Sunday ... 6 = Saturday (Postgres DOW convention)
export const branchHours = pgTable('branch_hours', {
  id: uuid('id').primaryKey().defaultRandom(),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
  weekday: integer('weekday').notNull(),
  opensAt: time('opens_at').notNull(),
  closesAt: time('closes_at').notNull(),
}, (t) => [
  index('branch_hours_branch_idx').on(t.branchId, t.weekday),
  // Without this, the seed's onConflictDoNothing() has no arbiter to match and silently
  // becomes a no-op — every reseed doubles the opening hours, and duplicated intervals
  // produce duplicated booking time slots.
  unique('branch_hours_unique').on(t.branchId, t.weekday, t.opensAt),
  check('weekday_range', sql`${t.weekday} BETWEEN 0 AND 6`),
  check('opens_before_closes', sql`${t.opensAt} < ${t.closesAt}`),
])

// FR-17.6 — managed table, not an enum
export const vehicleClasses = pgTable('vehicle_classes', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  displayOrder: integer('display_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
})

export const vehicles = pgTable('vehicles', {
  id: uuid('id').primaryKey().defaultRandom(),
  registration: text('registration').notNull().unique(),
  vin: text('vin').unique(),
  classId: uuid('class_id').notNull().references(() => vehicleClasses.id, { onDelete: 'restrict' }),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
  make: text('make').notNull(),
  model: text('model').notNull(),
  year: integer('year').notNull(),
  colour: text('colour').notNull(),
  transmission: text('transmission').notNull().default('automatic'),
  seats: integer('seats').notNull().default(5),
  odometerKm: integer('odometer_km').notNull().default(0),
  acquisitionCostFils: integer('acquisition_cost_fils').notNull().default(0),
  status: vehicleStatus('status').notNull().default('available'),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
    .$onUpdate(() => new Date()),
}, (t) => [
  index('vehicles_class_idx').on(t.classId),
  index('vehicles_branch_status_idx').on(t.branchId, t.status),
  check('year_sane', sql`${t.year} BETWEEN 1990 AND 2100`),
])

// FR-7.2 — expiry drives automatic blocking.
// `restrict`, not `cascade`: mulkiya and insurance records are compliance artifacts. A
// vehicle is retired via status, never deleted; an accidental DELETE must fail loudly.
export const vehicleDocuments = pgTable('vehicle_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'restrict' }),
  type: vehicleDocumentType('type').notNull(),
  documentNumber: text('document_number'),
  expiresOn: date('expires_on').notNull(),
  objectKey: text('object_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('vehicle_documents_expiry_idx').on(t.expiresOn),
  unique('vehicle_document_unique').on(t.vehicleId, t.type),
])

export const vehiclePhotos = pgTable('vehicle_photos', {
  id: uuid('id').primaryKey().defaultRandom(),
  vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
  objectKey: text('object_key').notNull(),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('vehicle_photos_vehicle_idx').on(t.vehicleId)])

// FR-7.3, FR-7.4 — an open job makes the vehicle unavailable.
// `restrict`: maintenance and cost history feeds fleet ROI reporting (FR-19.3) and must
// survive any attempt to delete the vehicle.
export const maintenanceJobs = pgTable('maintenance_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'restrict' }),
  status: maintenanceStatus('status').notNull().default('open'),
  reason: text('reason').notNull(),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on'),
  costFils: integer('cost_fils').notNull().default(0),
  odometerKm: integer('odometer_km'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('maintenance_vehicle_status_idx').on(t.vehicleId, t.status)])
