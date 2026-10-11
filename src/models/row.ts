import type { GraphRow } from "../repos/graphDb/index.ts";

export function pickNodeFields(
  row: GraphRow,
  alias: string,
  fields: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = row[`${alias}.${field}`] ?? row[field];
    out[field] = value === undefined ? null : value;
  }
  return out;
}
