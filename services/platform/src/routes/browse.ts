import { ApiError } from '@docbeam/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../db.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound(): ApiError {
  return new ApiError(404, 'NOT_FOUND', 'Not found.');
}

function callerId(request: FastifyRequest): string {
  if (request.principal?.tokenUse !== 'user') throw new ApiError(401, 'UNAUTHORIZED', 'Sign in again.');
  return request.principal.userId;
}

/** A malformed id gets the same 404 as an id that is not yours. */
function idParam(request: FastifyRequest, name: string): string {
  const value = (request.params as Record<string, string>)[name];
  if (!value || !UUID.test(value)) throw notFound();
  return value;
}

interface ContentRow extends Record<string, unknown> {
  kind: 'scope' | 'folder' | 'document';
  id: string;
  name: string | null;
  size_bytes: string | null;
  content_type: string | null;
  created_at: Date | null;
}

function contents(rows: ContentRow[]) {
  if (!rows.some((r) => r.kind === 'scope')) throw notFound();
  return {
    folders: rows.filter((r) => r.kind === 'folder').map((r) => ({ id: r.id, name: r.name })),
    documents: rows
      .filter((r) => r.kind === 'document')
      .map((r) => ({
        id: r.id,
        name: r.name,
        sizeBytes: Number(r.size_bytes),
        contentType: r.content_type,
        createdAt: r.created_at,
      })),
  };
}

/**
 * The four browse routes (ADR-006, ADR-010). Membership is part of every query: the rows come back only
 * if the caller is in the team that owns the binder, so a missing row is a 404 and nothing is revealed.
 * One level at a time, through indexed lookups, with no recursion on the browse path.
 */
export function registerBrowseRoutes(app: FastifyInstance, db: Db): void {
  const user = { preHandler: app.requireAuth({ use: 'user' }) };

  app.get('/teams', user, async (request) => {
    const userId = callerId(request);
    const result = await db.execute<{ id: string; name: string }>(sql`
      SELECT t.id, t.name
        FROM team_members m JOIN teams t ON t.id = m.team_id
       WHERE m.user_id = ${userId}
       ORDER BY t.name`);
    return result.rows;
  });

  app.get('/teams/:teamId/binders', user, async (request) => {
    const userId = callerId(request);
    const teamId = idParam(request, 'teamId');
    // Starts from the membership row, so an empty team is an empty list and a stranger gets no rows.
    const result = await db.execute<{ id: string | null; name: string | null }>(sql`
      SELECT b.id, b.name
        FROM team_members m LEFT JOIN binders b ON b.team_id = m.team_id
       WHERE m.team_id = ${teamId} AND m.user_id = ${userId}
       ORDER BY b.name`);
    if (result.rows.length === 0) throw notFound();
    return result.rows.filter((r) => r.id !== null);
  });

  app.get('/binders/:binderId/contents', user, async (request) => {
    const userId = callerId(request);
    const binderId = idParam(request, 'binderId');
    const result = await db.execute<ContentRow>(sql`
      WITH scope AS (
        SELECT b.id FROM binders b
          JOIN team_members m ON m.team_id = b.team_id AND m.user_id = ${userId}
         WHERE b.id = ${binderId})
      SELECT 'scope' AS kind, s.id, NULL AS name, NULL AS size_bytes, NULL AS content_type, NULL::timestamptz AS created_at FROM scope s
      UNION ALL
      SELECT 'folder', f.id, f.name, NULL, NULL, f.created_at
        FROM scope s JOIN folders f ON f.binder_id = s.id AND f.parent_folder_id IS NULL
      UNION ALL
      SELECT 'document', d.id, d.name, d.size_bytes::text, d.content_type, d.created_at
        FROM scope s JOIN documents d ON d.binder_id = s.id AND d.folder_id IS NULL
      ORDER BY kind DESC, name`);
    return contents(result.rows);
  });

  app.get('/folders/:folderId/contents', user, async (request) => {
    const userId = callerId(request);
    const folderId = idParam(request, 'folderId');
    const result = await db.execute<ContentRow>(sql`
      WITH scope AS (
        SELECT f.id FROM folders f
          JOIN binders b ON b.id = f.binder_id
          JOIN team_members m ON m.team_id = b.team_id AND m.user_id = ${userId}
         WHERE f.id = ${folderId})
      SELECT 'scope' AS kind, s.id, NULL AS name, NULL AS size_bytes, NULL AS content_type, NULL::timestamptz AS created_at FROM scope s
      UNION ALL
      SELECT 'folder', c.id, c.name, NULL, NULL, c.created_at
        FROM scope s JOIN folders c ON c.parent_folder_id = s.id
      UNION ALL
      SELECT 'document', d.id, d.name, d.size_bytes::text, d.content_type, d.created_at
        FROM scope s JOIN documents d ON d.folder_id = s.id
      ORDER BY kind DESC, name`);
    return contents(result.rows);
  });
}
