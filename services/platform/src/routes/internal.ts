import { ApiError } from '@docbeam/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import { pgArray } from '../sql.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const checkBody = z.object({
  userId: z.string().regex(UUID),
  destinations: z
    .array(z.object({ binderId: z.string(), folderId: z.string().nullish() }))
    .min(1)
    .max(100),
});

export interface ResolvedDestination {
  binderId: string;
  folderId: string | null;
  teamId: string;
  teamName: string;
  path: string;
}

interface CheckRow extends Record<string, unknown> {
  idx: number;
  team_id: string;
  team_name: string;
  binder_name: string;
  folder_path: string | null;
  folder_ok: boolean;
}

/**
 * Service routes, reached by DocBeam API, the WS handlers and the seed script (ADR-013).
 * The gateway does not list them, and they take service tokens only.
 */
export function registerInternalRoutes(app: FastifyInstance, db: Db): void {
  const memberships = { preHandler: app.requireAuth({ use: 'service', scope: 'memberships:read' }) };

  app.post('/destinations/check', memberships, async (request, reply) => {
    const parsed = checkBody.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'The userId and destinations are required.');
    const { userId, destinations } = parsed.data;

    // A malformed id cannot exist, so it is "not found" like any other bad destination.
    const wanted = destinations.map((d, idx) => ({
      idx,
      binderId: d.binderId,
      folderId: d.folderId ?? null,
      // A destination is a folder (D-F1-3): no folderId is "not found", like a malformed id.
      valid: UUID.test(d.binderId) && d.folderId != null && UUID.test(d.folderId),
    }));
    const valid = wanted.filter((w) => w.valid);

    const found = new Map<number, CheckRow>();
    if (valid.length > 0) {
      // One query for the whole batch. Each binder must exist, each folder must sit inside it, and the
      // user must be in the binder's team. The path walks up from the listed folders only.
      const result = await db.execute<CheckRow>(sql`
        WITH RECURSIVE input(idx, binder_id, folder_id) AS (
          SELECT * FROM unnest(${pgArray(valid.map((w) => w.idx), 'int')}, ${pgArray(valid.map((w) => w.binderId), 'uuid')}, ${pgArray(valid.map((w) => w.folderId), 'uuid')})
        ), chain AS (
          SELECT i.idx, f.parent_folder_id, f.name, 1 AS depth
            FROM input i JOIN folders f ON f.id = i.folder_id
          UNION ALL
          SELECT c.idx, p.parent_folder_id, p.name, c.depth + 1
            FROM chain c JOIN folders p ON p.id = c.parent_folder_id
        )
        SELECT i.idx, t.id AS team_id, t.name AS team_name, b.name AS binder_name,
               (SELECT string_agg(c.name, ' / ' ORDER BY c.depth DESC) FROM chain c WHERE c.idx = i.idx) AS folder_path,
               EXISTS (SELECT 1 FROM folders f WHERE f.id = i.folder_id AND f.binder_id = i.binder_id) AS folder_ok
          FROM input i
          JOIN binders b ON b.id = i.binder_id
          JOIN teams t ON t.id = b.team_id
          JOIN team_members m ON m.team_id = t.id AND m.user_id = ${userId}`);
      for (const row of result.rows) found.set(Number(row.idx), row);
    }

    const missing = wanted.filter((w) => !found.get(w.idx)?.folder_ok);
    if (missing.length > 0) {
      // The same answer for a missing binder and for one in another team.
      return reply.status(422).send({
        error: { code: 'DESTINATION_NOT_FOUND', message: 'Some destinations were not found.' },
        notFound: missing.map((m) => ({ binderId: m.binderId, folderId: m.folderId })),
      });
    }

    return {
      destinations: wanted.map((w): ResolvedDestination => {
        const row = found.get(w.idx) as CheckRow;
        const path = [row.team_name, row.binder_name, row.folder_path].filter(Boolean).join(' / ');
        return { binderId: w.binderId, folderId: w.folderId, teamId: row.team_id, teamName: row.team_name, path };
      }),
    };
  });

  app.get('/users/:userId/teams', memberships, async (request) => {
    const { userId } = request.params as { userId: string };
    if (!UUID.test(userId)) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
    const result = await db.execute<{ team_id: string }>(sql`SELECT team_id FROM team_members WHERE user_id = ${userId} ORDER BY team_id`);
    return { teamIds: result.rows.map((r) => r.team_id) };
  });
}
