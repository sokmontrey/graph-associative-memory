import { toTimestamp } from "../../db/schema.ts";
import {
  assertCypherIdentifier,
  type GraphDbRepo,
  type GraphParams,
  type GraphRow,
} from "../graphDb/index.ts";
import type { NodeFilter, NodeRepo, NodeRepoConfig } from "./index.ts";

const ALIAS = "n";

function asRecord(input: unknown): Record<string, unknown> {
  return input as Record<string, unknown>;
}

function assertNonNegativeInt(value: number | undefined, what: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${what} must be a non-negative integer, got ${value}`);
  }
}

export class LadybugNodeRepo<TNode, TUpsert extends { id: string }, TUpdate>
  implements NodeRepo<TNode, TUpsert, TUpdate>
{
  private readonly db: GraphDbRepo;
  private readonly label: string;
  private readonly fields: readonly string[];
  private readonly map: (row: GraphRow, alias?: string) => TNode;
  private readonly createdAtField?: string;

  constructor(db: GraphDbRepo, config: NodeRepoConfig<TNode, TUpsert, TUpdate>) {
    assertCypherIdentifier(config.label, "node label");
    for (const field of config.fields) assertCypherIdentifier(field, "node field");
    if (!config.fields.includes("id")) {
      throw new Error(`NodeRepo ${config.label}: fields must include "id"`);
    }
    if (config.createdAtField !== undefined) {
      assertCypherIdentifier(config.createdAtField, "createdAtField");
      if (!config.fields.includes(config.createdAtField)) {
        throw new Error(
          `NodeRepo ${config.label}: createdAtField ${JSON.stringify(config.createdAtField)} is not in fields`
        );
      }
    }
    this.db = db;
    this.label = config.label;
    this.fields = config.fields;
    this.map = config.map;
    this.createdAtField = config.createdAtField;
  }

  private assertKnownKeys(keys: string[], what: string): void {
    const unknown = keys.filter((key) => !this.fields.includes(key));
    if (unknown.length > 0) {
      throw new Error(
        `NodeRepo ${this.label}: unknown ${what} key(s) ${unknown.map((k) => JSON.stringify(k)).join(", ")}`
      );
    }
  }

  private returnClause(): string {
    return this.fields.map((field) => `${ALIAS}.${field}`).join(", ");
  }

  private buildWhere(filter: NodeFilter | undefined, params: GraphParams): string {
    const where = filter?.where;
    if (!where || Object.keys(where).length === 0) return "";
    this.assertKnownKeys(Object.keys(where), "filter");
    const clauses: string[] = [];
    let i = 0;
    for (const [key, value] of Object.entries(where)) {
      if (value === null) {
        clauses.push(`${ALIAS}.${key} IS NULL`);
      } else if (Array.isArray(value)) {
        const param = `w_${i++}`;
        params[param] = value as GraphParams[string];
        clauses.push(`${ALIAS}.${key} IN $${param}`);
      } else {
        const param = `w_${i++}`;
        params[param] = value;
        clauses.push(`${ALIAS}.${key} = $${param}`);
      }
    }
    return `WHERE ${clauses.join(" AND ")}`;
  }

  private buildTail(filter: NodeFilter | undefined): string {
    const orderBy = filter?.orderBy;
    const orderDir = filter?.orderDir ?? "ASC";
    assertNonNegativeInt(filter?.limit, "limit");
    assertNonNegativeInt(filter?.skip, "skip");
    let tail = "";
    if (orderBy !== undefined) {
      this.assertKnownKeys([orderBy], "orderBy");
      if (orderDir !== "ASC" && orderDir !== "DESC") {
        throw new Error(`orderDir must be ASC or DESC, got ${JSON.stringify(orderDir)}`);
      }
      tail += ` ORDER BY ${ALIAS}.${orderBy} ${orderDir}`;
    } else if (filter?.orderDir !== undefined) {
      throw new Error("orderDir requires orderBy");
    }
    if (filter?.skip !== undefined) tail += ` SKIP ${filter.skip}`;
    if (filter?.limit !== undefined) tail += ` LIMIT ${filter.limit}`;
    return tail;
  }

  async upsert(input: TUpsert): Promise<TNode> {
    const { id, ...rest } = asRecord(input);
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`NodeRepo ${this.label}: upsert requires a non-empty string id`);
    }
    const entries = Object.entries(rest).filter(([, value]) => value !== undefined);
    this.assertKnownKeys(entries.map(([key]) => key), "upsert");
    const params: GraphParams = { id };
    const provided = entries.map(([key, value], i) => {
      const param = `p_${i}`;
      params[param] = value as GraphParams[string];
      return { key, value, param };
    });
    const setAll = provided.map((p) => `${ALIAS}.${p.key} = $${p.param}`);
    // ON CREATE writes everything provided; ON MATCH only fills non-null
    // values (partial upsert). Use update() for exact-set semantics.
    const setFill = provided
      .filter((p) => p.value !== null)
      .map((p) => `${ALIAS}.${p.key} = $${p.param}`);
    let createSets = [...setAll];
    if (
      this.createdAtField !== undefined &&
      !entries.some(([key]) => key === this.createdAtField)
    ) {
      params["now"] = toTimestamp(new Date());
      createSets.push(`${ALIAS}.${this.createdAtField} = timestamp($now)`);
    }
    const onCreate = createSets.length > 0 ? ` ON CREATE SET ${createSets.join(", ")}` : "";
    const onMatch = setFill.length > 0 ? ` ON MATCH SET ${setFill.join(", ")}` : "";
    const row = await this.db.queryOne(
      `MERGE (${ALIAS}:${this.label} {id: $id})${onCreate}${onMatch} RETURN ${this.returnClause()};`,
      params
    );
    if (!row) throw new Error(`NodeRepo ${this.label}: upsert returned no row for ${id}`);
    return this.map(row, ALIAS);
  }

  async upsertMany(inputs: TUpsert[]): Promise<TNode[]> {
    const out: TNode[] = [];
    for (const input of inputs) out.push(await this.upsert(input));
    return out;
  }

  async findById(id: string): Promise<TNode | null> {
    const row = await this.db.queryOne(
      `MATCH (${ALIAS}:${this.label} {id: $id}) RETURN ${this.returnClause()};`,
      { id }
    );
    return row ? this.map(row, ALIAS) : null;
  }

  async exists(id: string): Promise<boolean> {
    return (await this.count({ where: { id } })) > 0;
  }

  async count(filter: NodeFilter = {}): Promise<number> {
    const params: GraphParams = {};
    const where = this.buildWhere(filter, params);
    const row = await this.db.queryOne(
      [`MATCH (${ALIAS}:${this.label})`, where, `RETURN count(${ALIAS}) AS c;`]
        .filter((part) => part.length > 0)
        .join(" "),
      params
    );
    return Number(Object.values(row ?? {})[0] ?? 0);
  }

  async findAll(filter: NodeFilter = {}): Promise<TNode[]> {
    const params: GraphParams = {};
    const where = this.buildWhere(filter, params);
    const tail = this.buildTail(filter);
    const rows = await this.db.query(
      [`MATCH (${ALIAS}:${this.label})`, where, `RETURN ${this.returnClause()}${tail};`]
        .filter((part) => part.length > 0)
        .join(" "),
      params
    );
    return rows.map((row) => this.map(row, ALIAS));
  }

  async update(id: string, patch: TUpdate): Promise<TNode | null> {
    const entries = Object.entries(asRecord(patch)).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return this.findById(id);
    this.assertKnownKeys(
      entries.map(([key]) => key),
      "update"
    );
    if (entries.some(([key]) => key === "id")) {
      throw new Error(`NodeRepo ${this.label}: update cannot change id`);
    }
    const params: GraphParams = { id };
    const sets = entries.map(([key, value], i) => {
      const param = `p_${i}`;
      params[param] = value as GraphParams[string];
      return `${ALIAS}.${key} = $${param}`;
    });
    const row = await this.db.queryOne(
      `MATCH (${ALIAS}:${this.label} {id: $id}) SET ${sets.join(", ")} RETURN ${this.returnClause()};`,
      params
    );
    return row ? this.map(row, ALIAS) : null;
  }

  async remove(id: string): Promise<boolean> {
    const row = await this.db.queryOne(
      `MATCH (${ALIAS}:${this.label} {id: $id}) DETACH DELETE ${ALIAS} RETURN count(${ALIAS}) AS c;`,
      { id }
    );
    return Number(Object.values(row ?? {})[0] ?? 0) > 0;
  }
}
