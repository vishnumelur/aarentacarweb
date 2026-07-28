import { pgTable, pgEnum, uuid, text, boolean, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core'

export const userRole = pgEnum('user_role', ['customer', 'chauffeur', 'staff', 'owner'])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: text('phone').notNull().unique(),
  email: text('email').unique(),
  fullName: text('full_name').notNull(),
  role: userRole('role').notNull().default('customer'),
  passwordHash: text('password_hash'),
  totpSecret: text('totp_secret'),
  // FK to branches.id lives in migrations/0014_users_branch_fk.sql, NOT here — fleet.ts
  // imports users from this file, so a `.references(() => branches.id)` call here would
  // create a circular import. Do not "fix" this without re-reading that migration first.
  branchId: uuid('branch_id'),
  isActive: boolean('is_active').notNull().default(true),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
    .$onUpdate(() => new Date()),
}, (t) => [index('users_role_idx').on(t.role)])

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('sessions_user_idx').on(t.userId)])

// FR-11.3 — immutable. No update or delete path exists in application code.
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  action: text('action').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('audit_entity_idx').on(t.entityType, t.entityId)])
