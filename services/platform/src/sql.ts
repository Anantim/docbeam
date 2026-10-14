import { sql, type SQL } from 'drizzle-orm';

/** Drizzle spreads a JS array into a tuple, so arrays are built as ARRAY[...] with a cast. */
export function pgArray(values: readonly (string | number | null)[], type: 'uuid' | 'int'): SQL {
  const items = values.map((v) => sql`${v}`);
  return sql`ARRAY[${sql.join(items, sql`, `)}]::${sql.raw(type)}[]`;
}
