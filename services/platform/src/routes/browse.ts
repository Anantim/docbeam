import { ApiError } from '@docbeam/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../db.js';
import { cutPage, readPageQuery, TEAMS_DEFAULT_LIMIT, type Position } from '../paging.js';

/** At most this many people in the Sender menu; a person is in a handful of teams, a team is a study group. */
const MEMBERS_LIMIT = 200;

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

interface NamedRow extends Record<string, unknown> {
  id: string;
  name: string;
}

interface ContentRow extends NamedRow {
  rank: number;
  size_bytes: string | null;
  content_type: string | null;
  created_at: Date | null;
}

/** The rows after a cursor, as a keyset condition: the order is rank, then name, then id, with no gaps or repeats. */
const afterContent = (after: Position | null) => (after ? sql`WHERE (rank, name, id) > (${after.rank}, ${after.name}, ${after.id}::uuid)` : sql``);

function contents(fetched: ContentRow[], limit: number) {
  const { rows, nextCursor } = cutPage(fetched, limit, (r) => (r.rank === 0 ? 0 : 1));
  return {
    folders: rows.filter((r) => r.rank === 0).map((r) => ({ id: r.id, name: r.name })),
    documents: rows
      .filter((r) => r.rank === 1)
      .map((r) => ({
        id: r.id,
        name: r.name,
        sizeBytes: Number(r.size_bytes),
        contentType: r.content_type,
        createdAt: r.created_at,
      })),
    nextCursor,
  };
}

/**
 * The four browse routes (ADR-006, ADR-010). Membership is part of every query: the rows come back only
 * if the caller is in the team that owns the binder, so a missing row is a 404 and nothing is revealed.
 * One level at a time, through indexed lookups, with no recursion on the browse path. Every list is a page:
 * `limit` (default 20, at most 100) and an opaque `cursor`, ordered by name then id, with `nextCursor` null at
 * the end (D-F1-6). A page is cut at the access check, so a stranger gets the same 404 on every page.
 */
export function registerBrowseRoutes(app: FastifyInstance, db: Db): void {
  const user = { preHandler: app.requireAuth({ use: 'user' }) };

  app.get('/teams', user, async (request) => {
    const userId = callerId(request);
    const { limit, after } = readPageQuery(request.query, TEAMS_DEFAULT_LIMIT);
    const result = await db.execute<NamedRow>(sql`
      SELECT t.id, t.name
        FROM team_members m JOIN teams t ON t.id = m.team_id
       WHERE m.user_id = ${userId}
         ${after ? sql`AND (t.name, t.id) > (${after.name}, ${after.id}::uuid)` : sql``}
       ORDER BY t.name, t.id
       LIMIT ${limit + 1}`);
    const { rows, nextCursor } = cutPage(result.rows, limit, () => 0);
    return { items: rows.map((r) => ({ id: r.id, name: r.name })), nextCursor };
  });

  // The people in the caller's teams, once each, by name: the choices of the Sender filter on the Status page (D-F1-21).
  // Only people who share a team with the caller are listed; a person in no team of theirs is not revealed.
  app.get('/teams/members', user, async (request) => {
    const userId = callerId(request);
    const result = await db.execute<{ user_id: string; name: string }>(sql`
      SELECT other.user_id, max(other.user_name) AS name
        FROM team_members mine JOIN team_members other ON other.team_id = mine.team_id
       WHERE mine.user_id = ${userId}
       GROUP BY other.user_id
       ORDER BY max(other.user_name), other.user_id
       LIMIT ${MEMBERS_LIMIT}`);
    return { items: result.rows.map((r) => ({ userId: r.user_id, name: r.name })) };
  });

  app.get('/teams/:teamId/binders', user, async (request) => {
    const userId = callerId(request);
    const teamId = idParam(request, 'teamId');
    const { limit, after } = readPageQuery(request.query);
    // The membership row decides: an empty team is an empty page, and a stranger gets a 404 on every page.
    const member = await db.execute(sql`SELECT 1 FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId}`);
    if (member.rows.length === 0) throw notFound();
    const result = await db.execute<NamedRow>(sql`
      SELECT b.id, b.name
        FROM binders b
       WHERE b.team_id = ${teamId}
         ${after ? sql`AND (b.name, b.id) > (${after.name}, ${after.id}::uuid)` : sql``}
       ORDER BY b.name, b.id
       LIMIT ${limit + 1}`);
    const { rows, nextCursor } = cutPage(result.rows, limit, () => 0);
    return { items: rows.map((r) => ({ id: r.id, name: r.name })), nextCursor };
  });

  app.get('/binders/:binderId/contents', user, async (request) => {
    const userId = callerId(request);
    const binderId = idParam(request, 'binderId');
    const { limit, after } = readPageQuery(request.query);
    const scope = await db.execute(sql`
      SELECT b.id FROM binders b
        JOIN team_members m ON m.team_id = b.team_id AND m.user_id = ${userId}
       WHERE b.id = ${binderId}`);
    if (scope.rows.length === 0) throw notFound();
    const result = await db.execute<ContentRow>(sql`
      SELECT * FROM (
        SELECT 0 AS rank, f.id, f.name, NULL::text AS size_bytes, NULL::text AS content_type, f.created_at
          FROM folders f WHERE f.binder_id = ${binderId} AND f.parent_folder_id IS NULL
        UNION ALL
        SELECT 1, d.id, d.name, d.size_bytes::text, d.content_type, d.created_at
          FROM documents d WHERE d.binder_id = ${binderId} AND d.folder_id IS NULL) c
      ${afterContent(after)}
      ORDER BY rank, name, id
      LIMIT ${limit + 1}`);
    return contents(result.rows, limit);
  });

  app.get('/folders/:folderId/contents', user, async (request) => {
    const userId = callerId(request);
    const folderId = idParam(request, 'folderId');
    const { limit, after } = readPageQuery(request.query);
    const scope = await db.execute(sql`
      SELECT f.id FROM folders f
        JOIN binders b ON b.id = f.binder_id
        JOIN team_members m ON m.team_id = b.team_id AND m.user_id = ${userId}
       WHERE f.id = ${folderId}`);
    if (scope.rows.length === 0) throw notFound();
    const result = await db.execute<ContentRow>(sql`
      SELECT * FROM (
        SELECT 0 AS rank, c.id, c.name, NULL::text AS size_bytes, NULL::text AS content_type, c.created_at
          FROM folders c WHERE c.parent_folder_id = ${folderId}
        UNION ALL
        SELECT 1, d.id, d.name, d.size_bytes::text, d.content_type, d.created_at
          FROM documents d WHERE d.folder_id = ${folderId}) c
      ${afterContent(after)}
      ORDER BY rank, name, id
      LIMIT ${limit + 1}`);
    return contents(result.rows, limit);
  });
}
