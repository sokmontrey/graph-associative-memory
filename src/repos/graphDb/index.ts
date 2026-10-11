export type GraphValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | Date
  | GraphValue[]
  | { [key: string]: GraphValue };

export type GraphRow = Record<string, GraphValue>;

export type GraphParams = Record<string, GraphValue | undefined>;

export interface PreparedQuery {
  execute(params?: GraphParams): Promise<GraphRow[]>;
  executeOne(params?: GraphParams): Promise<GraphRow>;
}

export interface GraphDbRepo {
  readonly isOpen: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  query(statement: string, params?: GraphParams): Promise<GraphRow[]>;
  queryOne(statement: string, params?: GraphParams): Promise<GraphRow | null>;
  prepare(statement: string): Promise<PreparedQuery>;
}

// Labels, table names, and property keys are interpolated into Cypher text
// (they cannot be parameters), so every generic repo must pass them through
// here. Rejects anything that is not a bare identifier — no injection.
const CYPHER_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertCypherIdentifier(value: string, what = "identifier"): void {
  if (!CYPHER_IDENTIFIER.test(value)) {
    throw new Error(`Invalid ${what}: ${JSON.stringify(value)}`);
  }
}

export { LadybugGraphDbRepo, type LadybugGraphDbRepoOptions } from "./ladybugGraphDb.ts";
