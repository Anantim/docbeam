import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './db.js';
import { pgArray } from './sql.js';

// The seed file is the only way the hierarchy and the memberships get into Platform DB in v1 (Step 1.2).
// The script makes the database match the file: it adds what is new, renames what changed and removes
// memberships the file no longer lists. Teams, binders and folders are never deleted.

export interface FolderSeed {
  id: string;
  name: string;
  folders: FolderSeed[];
}

const folderSchema: z.ZodType<FolderSeed> = z.lazy(() =>
  z.object({ id: z.uuid(), name: z.string().min(1), folders: z.array(folderSchema) }),
);

export const seedFileSchema = z.object({
  users: z.array(z.object({ email: z.string().email(), name: z.string().min(1) })),
  teams: z.array(
    z.object({
      id: z.uuid(),
      name: z.string().min(1),
      members: z.array(z.string().email()),
      binders: z.array(z.object({ id: z.uuid(), name: z.string().min(1), folders: z.array(folderSchema) })),
    }),
  ),
});
export type SeedFile = z.infer<typeof seedFileSchema>;

export interface SeedReport {
  teamsChanged: number;
  bindersChanged: number;
  foldersChanged: number;
  membersAdded: number;
  membersRemoved: number;
  skippedEmails: string[];
}

interface FolderRow {
  id: string;
  binderId: string;
  parentId: string | null;
  name: string;
}

function flatten(binderId: string, folders: FolderSeed[], parentId: string | null, out: FolderRow[]): void {
  for (const f of folders) {
    out.push({ id: f.id, binderId, parentId, name: f.name });
    flatten(binderId, f.folders, f.id, out);
  }
}

/** Parents come before children in `rows`, so one ordered insert satisfies the foreign key. */
export async function applySeed(db: Db, file: SeedFile, userIdsByEmail: Map<string, string>): Promise<SeedReport> {
  const report: SeedReport = {
    teamsChanged: 0,
    bindersChanged: 0,
    foldersChanged: 0,
    membersAdded: 0,
    membersRemoved: 0,
    skippedEmails: [],
  };
  const skipped = new Set<string>();

  await db.transaction(async (tx) => {
    for (const team of file.teams) {
      const t = await tx.execute(sql`
        INSERT INTO teams (id, name) VALUES (${team.id}, ${team.name})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name WHERE teams.name IS DISTINCT FROM EXCLUDED.name
        RETURNING id`);
      report.teamsChanged += t.rowCount ?? 0;

      for (const binder of team.binders) {
        const b = await tx.execute(sql`
          INSERT INTO binders (id, team_id, name) VALUES (${binder.id}, ${team.id}, ${binder.name})
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, team_id = EXCLUDED.team_id
            WHERE binders.name IS DISTINCT FROM EXCLUDED.name OR binders.team_id IS DISTINCT FROM EXCLUDED.team_id
          RETURNING id`);
        report.bindersChanged += b.rowCount ?? 0;

        const rows: FolderRow[] = [];
        flatten(binder.id, binder.folders, null, rows);
        for (const f of rows) {
          const r = await tx.execute(sql`
            INSERT INTO folders (id, binder_id, parent_folder_id, name) VALUES (${f.id}, ${f.binderId}, ${f.parentId}, ${f.name})
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, parent_folder_id = EXCLUDED.parent_folder_id
              WHERE folders.name IS DISTINCT FROM EXCLUDED.name
                 OR folders.parent_folder_id IS DISTINCT FROM EXCLUDED.parent_folder_id
            RETURNING id`);
          report.foldersChanged += r.rowCount ?? 0;
        }
      }

      const wanted: string[] = [];
      for (const email of team.members) {
        const id = userIdsByEmail.get(email.toLowerCase());
        if (id) wanted.push(id);
        else skipped.add(email);
      }
      if (wanted.length > 0) {
        const added = await tx.execute(sql`
          INSERT INTO team_members (team_id, user_id)
          SELECT ${team.id}::uuid, u FROM unnest(${pgArray(wanted, 'uuid')}) AS u
          ON CONFLICT DO NOTHING RETURNING user_id`);
        report.membersAdded += added.rowCount ?? 0;
      }
      const removed = await tx.execute(sql`
        DELETE FROM team_members WHERE team_id = ${team.id} AND NOT (user_id = ANY(${pgArray(wanted, 'uuid')}))
        RETURNING user_id`);
      report.membersRemoved += removed.rowCount ?? 0;
    }
  });

  report.skippedEmails = [...skipped].sort();
  return report;
}
