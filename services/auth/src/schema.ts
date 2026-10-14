import { sql } from 'drizzle-orm';
import { customType, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Auth DB (TDD "Database design"). users proves who someone is and nothing more.

const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: citext('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  /** Wrong passwords in a row. */
  failedLogins: integer('failed_logins').notNull().default(0),
  /** Sign-in is paused until then. */
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const serviceClients = pgTable('service_clients', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clientId: text('client_id').notNull().unique(),
  clientSecretHash: text('client_secret_hash').notNull(),
  scopes: text('scopes').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** One per sign-in; every token of it shares this. */
    familyId: uuid('family_id').notNull(),
    /** SHA-256 of the token. The token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    /** 12 hours after sign-in. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_refresh_family').on(t.familyId)],
);
