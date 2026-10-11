import { Connection, Database, type LbugValue } from "@ladybugdb/core";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ensureSchema } from "../../db/schema.ts";
import type { GraphDbRepo, GraphParams, GraphRow, PreparedQuery } from "./index.ts";

export type LadybugGraphDbRepoOptions = {
  dbPath: string;
  ensureDir?: boolean;
};

function toLbugParams(params: GraphParams): Record<string, LbugValue> {
  const out: Record<string, LbugValue> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = (value ?? null) as LbugValue;
  }
  return out;
}

function toGraphRows(rows: Record<string, LbugValue>[]): GraphRow[] {
  return rows as unknown as GraphRow[];
}

class LadybugPreparedQuery implements PreparedQuery {
  private readonly conn: Connection;
  private readonly statement: Awaited<ReturnType<Connection["prepare"]>>;

  constructor(conn: Connection, statement: Awaited<ReturnType<Connection["prepare"]>>) {
    this.conn = conn;
    this.statement = statement;
  }

  async execute(params: GraphParams = {}): Promise<GraphRow[]> {
    const result = await this.conn.execute(this.statement, toLbugParams(params));
    if (Array.isArray(result)) {
      throw new Error("Expected a single query result.");
    }
    return toGraphRows(await result.getAll());
  }

  async executeOne(params: GraphParams = {}): Promise<GraphRow> {
    const rows = await this.execute(params);
    const row = rows[0];
    if (!row) throw new Error("Expected a single row, got none.");
    return row;
  }
}

export class LadybugGraphDbRepo implements GraphDbRepo {
  private readonly dbPath: string;
  private readonly ensureDir: boolean;
  private database: Database | null = null;
  private connection: Connection | null = null;

  constructor(options: LadybugGraphDbRepoOptions) {
    this.dbPath = options.dbPath;
    this.ensureDir = options.ensureDir ?? true;
  }

  get isOpen(): boolean {
    return this.connection !== null;
  }

  async open(): Promise<void> {
    if (this.connection) return;
    if (this.ensureDir) {
      mkdirSync(dirname(this.dbPath), { recursive: true });
    }
    this.database = new Database(this.dbPath);
    this.connection = new Connection(this.database);
    await ensureSchema(this.connection);
  }

  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
    if (this.database) {
      await this.database.close();
      this.database = null;
    }
  }

  async query(statement: string, params: GraphParams = {}): Promise<GraphRow[]> {
    const conn = this.requireConnection();
    if (Object.keys(params).length === 0) {
      const result = await conn.query(statement);
      if (Array.isArray(result)) {
        throw new Error("Expected a single query result.");
      }
      return toGraphRows(await result.getAll());
    }
    const prepared = await conn.prepare(statement);
    const result = await conn.execute(prepared, toLbugParams(params));
    if (Array.isArray(result)) {
      throw new Error("Expected a single query result.");
    }
    return toGraphRows(await result.getAll());
  }

  async queryOne(statement: string, params: GraphParams = {}): Promise<GraphRow | null> {
    const rows = await this.query(statement, params);
    return rows[0] ?? null;
  }

  async prepare(statement: string): Promise<PreparedQuery> {
    const conn = this.requireConnection();
    return new LadybugPreparedQuery(conn, await conn.prepare(statement));
  }

  private requireConnection(): Connection {
    if (!this.connection) {
      throw new Error("Database is not open. Call open() first.");
    }
    return this.connection;
  }
}
