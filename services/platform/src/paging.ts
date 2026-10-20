import { ApiError } from '@docbeam/shared';

/** Binders and folders come 20 at a time; the list of teams comes 50 at a time, so a person in 50 teams gets them in one call (D-F1-16). */
export const DEFAULT_LIMIT = 20;
export const TEAMS_DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where a page ended: folders come before documents (rank 0, then 1), each by name then id (F1 part B, D-F1-6). */
export interface Position {
  rank: 0 | 1;
  name: string;
  id: string;
}

export interface PageQuery {
  limit: number;
  after: Position | null;
}

/** An opaque cursor: the position of the last row of a page. The client only hands it back. */
export function encodeCursor(position: Position): string {
  return Buffer.from(JSON.stringify([position.rank, position.name, position.id]), 'utf8').toString('base64url');
}

function badCursor(): ApiError {
  return new ApiError(400, 'VALIDATION_ERROR', 'The cursor is not valid. Start again from the first page.');
}

export function decodeCursor(cursor: string): Position {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw badCursor();
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) throw badCursor();
  const [rank, name, id] = parsed as unknown[];
  if ((rank !== 0 && rank !== 1) || typeof name !== 'string' || typeof id !== 'string' || !UUID.test(id)) throw badCursor();
  return { rank, name, id };
}

/** Reads `limit` (1 to 100, default 20 unless the route says otherwise) and `cursor` from a query string; anything else is a 400. */
export function readPageQuery(query: unknown, defaultLimit: number = DEFAULT_LIMIT): PageQuery {
  const q = (query ?? {}) as Record<string, unknown>;
  let limit = defaultLimit;
  if (q['limit'] !== undefined) {
    const raw = q['limit'];
    if (typeof raw !== 'string' || !/^\d{1,4}$/.test(raw)) throw new ApiError(400, 'VALIDATION_ERROR', `limit must be a whole number from 1 to ${MAX_LIMIT}.`);
    limit = Number(raw);
    if (limit < 1 || limit > MAX_LIMIT) throw new ApiError(400, 'VALIDATION_ERROR', `limit must be a whole number from 1 to ${MAX_LIMIT}.`);
  }
  const cursor = q['cursor'];
  if (cursor !== undefined && (typeof cursor !== 'string' || cursor === '')) throw badCursor();
  return { limit, after: typeof cursor === 'string' ? decodeCursor(cursor) : null };
}

export interface Page<T> {
  rows: T[];
  nextCursor: string | null;
}

/** Takes the rows fetched with `limit + 1`: the extra row only shows that another page exists. */
export function cutPage<T extends { id: string; name: string }>(fetched: T[], limit: number, rankOf: (row: T) => 0 | 1): Page<T> {
  const rows = fetched.slice(0, limit);
  const last = rows.at(-1);
  const more = fetched.length > limit && last !== undefined;
  return { rows, nextCursor: more ? encodeCursor({ rank: rankOf(last), name: last.name, id: last.id }) : null };
}
