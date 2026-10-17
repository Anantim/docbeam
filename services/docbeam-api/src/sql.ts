import { sql, type SQL } from 'drizzle-orm';

/**
 * A Postgres array literal, for example `{"a","b\"c",NULL}`. Every element is quoted, so commas, braces,
 * quotes and spaces in a value cannot change its meaning.
 */
export function arrayLiteral(values: readonly (string | number | null)[]): string {
  const items = values.map((v) => (v === null ? 'NULL' : `"${String(v).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`));
  return `{${items.join(',')}}`;
}

/**
 * One bound parameter per array, cast to the column type. (Drizzle would spread a JS array into one parameter per
 * element: a job of 100 files to 20 folders sent 10,000 parameters and spent 0.8 to 1.3 s parsing them, D-M5-10.)
 */
export function pgArray(values: readonly (string | number | null)[], type: 'uuid' | 'text' | 'int'): SQL {
  return sql`${arrayLiteral(values)}::${sql.raw(type)}[]`;
}
