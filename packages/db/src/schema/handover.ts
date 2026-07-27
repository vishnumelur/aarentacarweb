import {
  pgTable, pgEnum, uuid, text, integer, timestamp, check, index, uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { bookings } from './booking'
import { users } from './identity'

export const handoverKind = pgEnum('handover_kind', ['pickup', 'return'])
export const damageSeverity = pgEnum('damage_severity', ['scratch', 'dent', 'crack', 'missing'])

// NFR-11 — handovers are superseded, never deleted or edited in place.
export const handovers = pgTable('handovers', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'restrict' }),
  kind: handoverKind('kind').notNull(),
  odometerKm: integer('odometer_km').notNull(),
  fuelLevelEighths: integer('fuel_level_eighths').notNull(),
  checklist: text('checklist'),
  notes: text('notes'),
  conductedByUserId: uuid('conducted_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  // NFR-11 — signature evidence
  signatureObjectKey: text('signature_object_key'),
  signatureIpAddress: text('signature_ip_address'),
  termsVersion: text('terms_version'),
  contractObjectKey: text('contract_object_key'),
  supersededById: uuid('superseded_by_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // one active record per booking per kind; superseded rows are excluded
  uniqueIndex('handover_active_unique')
    .on(t.bookingId, t.kind)
    .where(sql`${t.supersededById} IS NULL`),
  check('fuel_eighths_range', sql`${t.fuelLevelEighths} BETWEEN 0 AND 8`),
  check('odometer_non_negative', sql`${t.odometerKm} >= 0`),
])

export const inspectionPhotos = pgTable('inspection_photos', {
  id: uuid('id').primaryKey().defaultRandom(),
  handoverId: uuid('handover_id').notNull().references(() => handovers.id, { onDelete: 'restrict' }),
  objectKey: text('object_key').notNull(),
  angle: text('angle').notNull(),
  uploadedByUserId: uuid('uploaded_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  // NFR-11 — server-side timestamp; client clocks are not trusted
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('inspection_photos_handover_idx').on(t.handoverId)])

export const damageMarkers = pgTable('damage_markers', {
  id: uuid('id').primaryKey().defaultRandom(),
  handoverId: uuid('handover_id').notNull().references(() => handovers.id, { onDelete: 'restrict' }),
  panel: text('panel').notNull(),
  xPercent: integer('x_percent').notNull(),
  yPercent: integer('y_percent').notNull(),
  severity: damageSeverity('severity').notNull(),
  notes: text('notes'),
  photoId: uuid('photo_id').references(() => inspectionPhotos.id),
}, (t) => [
  index('damage_markers_handover_idx').on(t.handoverId),
  check('x_percent_range', sql`${t.xPercent} BETWEEN 0 AND 100`),
  check('y_percent_range', sql`${t.yPercent} BETWEEN 0 AND 100`),
])
