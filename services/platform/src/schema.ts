import { sql } from 'drizzle-orm';
import { bigint, index, pgTable, primaryKey, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

// Platform DB (TDD "Database design"). Nothing in v1 creates teams, binders, folders or members:
// the seed script loads them (Step 1.2).

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    /** Auth DB user id. No cross-database foreign key (ADR-009). */
    userId: uuid('user_id').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] }), index('idx_team_members_user').on(t.userId)],
);

export const binders = pgTable(
  'binders',
  {
    id: uuid('id').primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_binders_team').on(t.teamId)],
);

export const folders = pgTable(
  'folders',
  {
    id: uuid('id').primaryKey(),
    binderId: uuid('binder_id')
      .notNull()
      .references(() => binders.id),
    /** NULL = top level of the binder. */
    parentFolderId: uuid('parent_folder_id').references((): AnyPgColumn => folders.id),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_folders_parent').on(t.binderId, t.parentFolderId)],
);

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  binderId: uuid('binder_id')
    .notNull()
    .references(() => binders.id),
  folderId: uuid('folder_id').references(() => folders.id),
  name: text('name').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  contentType: text('content_type').notNull(),
  checksumSha256: text('checksum_sha256').notNull(),
  /** documents/{id} in the Platform File Store. */
  storageKey: text('storage_key').notNull(),
  /** Makes ingest safe to repeat. */
  sourceTaskId: uuid('source_task_id').unique(),
  /** The onBehalfOf user. */
  uploadedByUserId: uuid('uploaded_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
