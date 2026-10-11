import { toTimestamp } from "../../db/schema.ts";
import {
  assertCypherIdentifier,
  type GraphDbRepo,
  type GraphParams,
  type GraphRow,
} from "../graphDb/index.ts";
import type {
  EdgeCreate,
  EdgeDirection,
  EdgeEndpoints,
  EdgeFilter,
  EdgeProps,
  EdgeRepo,
  EdgeTableConfig,
  EdgeWhereValue,
  NeighborQuery,
  TraverseQuery,
} from "./index.ts";

function assertNonNegativeInt(value: number | undefined, what: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${what} must be a non-negative integer, got ${value}`);
  }
}

function assertHops(value: number | undefined, what: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > 30) {
    throw new Error(`${what} must be an integer in 0..30, got ${value}`);
  }
  return value;
}

export class LadybugEdgeRepo implements EdgeRepo {
  private readonly db: GraphDbRepo;
  private readonly tables: Map<string, EdgeTableConfig>;

  constructor(db: GraphDbRepo, tables: readonly EdgeTableConfig[]) {
    this.tables = new Map();
    for (const config of tables) {
      assertCypherIdentifier(config.table, "rel table");
      assertCypherIdentifier(config.fromLabel, "from label");
      assertCypherIdentifier(config.toLabel, "to label");
      for (const prop of config.props) assertCypherIdentifier(prop, "edge prop");
      if (config.createdAtField !== undefined) {
        assertCypherIdentifier(config.createdAtField, "createdAtField");
        if (!config.props.includes(config.createdAtField)) {
          throw new Error(
            `EdgeRepo ${config.table}: createdAtField ${JSON.stringify(config.createdAtField)} is not in props`
          );
        }
      }
      if (this.tables.has(config.table)) {
        throw new Error(`EdgeRepo: duplicate table ${JSON.stringify(config.table)}`);
      }
      this.tables.set(config.table, config);
    }
    this.db = db;
  }

  private resolve(table: string): EdgeTableConfig {
    const config = this.tables.get(table);
    if (!config) {
      throw new Error(
        `EdgeRepo: unknown table ${JSON.stringify(table)} (known: ${[...this.tables.keys()].join(", ") || "none"})`
      );
    }
    return config;
  }

  private edgeReturn(config: EdgeTableConfig): string {
    return [`a.id AS from_id`, `b.id AS to_id`]
      .concat(config.props.map((prop) => `e.${prop} AS e_${prop}`))
      .join(", ");
  }

  /** fromId/toId always refer to the a/b roles, regardless of direction. */
  private pattern(config: EdgeTableConfig, direction: EdgeDirection): string {
    const left = `a:${config.fromLabel}`;
    const right = `b:${config.toLabel}`;
    if (direction === "in") return `(${left})<-[e:${config.table}]-(${right})`;
    if (direction === "both") return `(${left})-[e:${config.table}]-(${right})`;
    return `(${left})-[e:${config.table}]->(${right})`;
  }

  private endpointClauses(filter: { fromId?: string; toId?: string }, params: GraphParams): string[] {
    const clauses: string[] = [];
    if (filter.fromId !== undefined) {
      params["from"] = filter.fromId;
      clauses.push("a.id = $from");
    }
    if (filter.toId !== undefined) {
      params["to"] = filter.toId;
      clauses.push("b.id = $to");
    }
    return clauses;
  }

  private edgeWhere(
    config: EdgeTableConfig,
    where: Record<string, EdgeWhereValue> | undefined,
    params: GraphParams,
    prefix: string,
    alias = "e"
  ): string[] {
    if (!where || Object.keys(where).length === 0) return [];
    const unknown = Object.keys(where).filter((key) => !config.props.includes(key));
    if (unknown.length > 0) {
      throw new Error(
        `EdgeRepo ${config.table}: unknown where key(s) ${unknown.map((k) => JSON.stringify(k)).join(", ")}`
      );
    }
    const clauses: string[] = [];
    let i = 0;
    for (const [key, value] of Object.entries(where)) {
      if (value === null) {
        clauses.push(`${alias}.${key} IS NULL`);
      } else if (Array.isArray(value)) {
        const param = `${prefix}_${i++}`;
        params[param] = value as GraphParams[string];
        clauses.push(`${alias}.${key} IN $${param}`);
      } else {
        const param = `${prefix}_${i++}`;
        params[param] = value;
        clauses.push(`${alias}.${key} = $${param}`);
      }
    }
    return clauses;
  }

  private tailClause(orderBy: string | undefined, orderDir: "ASC" | "DESC" | undefined, limit: number | undefined, skip: number | undefined, orderScope: readonly string[]): string {
    assertNonNegativeInt(limit, "limit");
    assertNonNegativeInt(skip, "skip");
    let tail = "";
    if (orderBy !== undefined) {
      if (!orderScope.includes(orderBy)) {
        throw new Error(`EdgeRepo: cannot order by ${JSON.stringify(orderBy)}`);
      }
      if (orderDir !== undefined && orderDir !== "ASC" && orderDir !== "DESC") {
        throw new Error(`orderDir must be ASC or DESC, got ${JSON.stringify(orderDir)}`);
      }
      const target =
        orderBy === "from_id" ? "from_id" : orderBy === "to_id" ? "to_id" : `e_${orderBy}`;
      tail += ` ORDER BY ${target} ${orderDir ?? "ASC"}`;
    } else if (orderDir !== undefined) {
      throw new Error("orderDir requires orderBy");
    }
    if (skip !== undefined) tail += ` SKIP ${skip}`;
    if (limit !== undefined) tail += ` LIMIT ${limit}`;
    return tail;
  }

  async create(input: EdgeCreate): Promise<GraphRow> {
    const config = this.resolve(input.table);
    const props = Object.entries(input.props ?? {}).filter(([, value]) => value !== undefined);
    const unknown = props.map(([key]) => key).filter((key) => !config.props.includes(key));
    if (unknown.length > 0) {
      throw new Error(
        `EdgeRepo ${config.table}: unknown prop(s) ${unknown.map((k) => JSON.stringify(k)).join(", ")}`
      );
    }
    const params: GraphParams = { from: input.fromId, to: input.toId };
    const sets = props.map(([key, value], i) => {
      const param = `p_${i}`;
      params[param] = value as GraphParams[string];
      return `${key}: $${param}`;
    });
    if (
      config.createdAtField !== undefined &&
      !props.some(([key]) => key === config.createdAtField)
    ) {
      params["now"] = toTimestamp(new Date());
      sets.push(`${config.createdAtField}: timestamp($now)`);
    }
    const row = await this.db.queryOne(
      `MATCH (a:${config.fromLabel} {id: $from}), (b:${config.toLabel} {id: $to})` +
        ` CREATE (a)-[e:${config.table} {${sets.join(", ")}}]->(b)` +
        ` RETURN ${this.edgeReturn(config)};`,
      params
    );
    if (!row) {
      throw new Error(
        `EdgeRepo: no ${config.table} edge created, missing endpoint(s) ${input.fromId} -> ${input.toId}`
      );
    }
    return row;
  }

  async list(filter: EdgeFilter): Promise<GraphRow[]> {
    const config = this.resolve(filter.table);
    const direction: EdgeDirection = filter.direction ?? "out";
    const params: GraphParams = {};
    const clauses = [
      ...this.endpointClauses(filter, params),
      ...this.edgeWhere(config, filter.where, params, "w"),
    ];
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const tail = this.tailClause(
      filter.orderBy,
      filter.orderDir,
      filter.limit,
      filter.skip,
      [...config.props, "from_id", "to_id"]
    );
    return this.db.query(
      [`MATCH ${this.pattern(config, direction)}`, where, `RETURN ${this.edgeReturn(config)}${tail};`]
        .filter((part) => part.length > 0)
        .join(" "),
      params
    );
  }

  async count(filter: EdgeFilter): Promise<number> {
    const config = this.resolve(filter.table);
    const direction: EdgeDirection = filter.direction ?? "out";
    const params: GraphParams = {};
    const clauses = [
      ...this.endpointClauses(filter, params),
      ...this.edgeWhere(config, filter.where, params, "w"),
    ];
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const row = await this.db.queryOne(
      [`MATCH ${this.pattern(config, direction)}`, where, `RETURN count(e) AS c;`]
        .filter((part) => part.length > 0)
        .join(" "),
      params
    );
    return Number(Object.values(row ?? {})[0] ?? 0);
  }

  async update(
    key: EdgeEndpoints,
    patch: EdgeProps,
    where?: Record<string, EdgeWhereValue>
  ): Promise<GraphRow[]> {
    const config = this.resolve(key.table);
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (entries.length === 0 && (!where || Object.keys(where).length === 0)) {
      return this.list(key);
    }
    const unknown = entries.map(([k]) => k).filter((k) => !config.props.includes(k));
    if (unknown.length > 0) {
      throw new Error(
        `EdgeRepo ${config.table}: unknown patch key(s) ${unknown.map((k) => JSON.stringify(k)).join(", ")}`
      );
    }
    const params: GraphParams = {};
    const clauses = [
      ...this.endpointClauses(key, params),
      ...this.edgeWhere(config, where, params, "w"),
    ];
    const sets = entries.map(([k, value], i) => {
      const param = `p_${i}`;
      params[param] = value as GraphParams[string];
      return `e.${k} = $${param}`;
    });
    const setClause = sets.length > 0 ? `SET ${sets.join(", ")}` : "";
    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db.query(
      [
        `MATCH ${this.pattern(config, "out")}`,
        whereClause,
        setClause,
        `RETURN ${this.edgeReturn(config)};`,
      ]
        .filter((part) => part.length > 0)
        .join(" "),
      params
    );
  }

  async remove(filter: EdgeFilter): Promise<number> {
    const config = this.resolve(filter.table);
    const direction: EdgeDirection = filter.direction ?? "out";
    const params: GraphParams = {};
    const clauses = [
      ...this.endpointClauses(filter, params),
      ...this.edgeWhere(config, filter.where, params, "w"),
    ];
    if (clauses.length === 0) {
      throw new Error(
        `EdgeRepo: remove on ${config.table} requires at least one of fromId, toId, where`
      );
    }
    const row = await this.db.queryOne(
      `MATCH ${this.pattern(config, direction)} WHERE ${clauses.join(" AND ")} DELETE e RETURN count(e) AS c;`,
      params
    );
    return Number(Object.values(row ?? {})[0] ?? 0);
  }

  async neighbors<T>(query: NeighborQuery, map: (row: GraphRow) => T): Promise<T[]> {
    const config = this.resolve(query.table);
    const direction: EdgeDirection = query.direction ?? "out";
    for (const prop of query.nodeProps) assertCypherIdentifier(prop, "neighbor prop");
    const edgeProps = query.edgeProps ?? config.props;
    const unknownEdge = edgeProps.filter((p) => !config.props.includes(p));
    if (unknownEdge.length > 0) {
      throw new Error(
        `EdgeRepo ${config.table}: unknown edge prop(s) ${unknownEdge.map((p) => JSON.stringify(p)).join(", ")}`
      );
    }
    const params: GraphParams = { from: query.fromId };
    const clauses = this.edgeWhere(config, query.where, params, "w");
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    assertNonNegativeInt(query.limit, "limit");
    const returns = query.nodeProps
      .map((prop) => `m.${prop} AS m_${prop}`)
      .concat(edgeProps.map((prop) => `e.${prop} AS e_${prop}`));
    const pattern =
      direction === "in"
        ? `(m:${config.fromLabel})-[e:${config.table}]->(a:${config.toLabel} {id: $from})`
        : direction === "both"
          ? `(a {id: $from})-[e:${config.table}]-(m)`
          : `(a:${config.fromLabel} {id: $from})-[e:${config.table}]->(m:${config.toLabel})`;
    const rows = await this.db.query(
      [`MATCH ${pattern}`, where, `RETURN ${returns.join(", ")}${query.limit !== undefined ? ` LIMIT ${query.limit}` : ""};`]
        .filter((part) => part.length > 0)
        .join(" "),
      params
    );
    return rows.map(map);
  }

  async traverse(query: TraverseQuery): Promise<GraphRow[]> {
    assertCypherIdentifier(query.fromLabel, "from label");
    if (query.toLabel !== undefined) assertCypherIdentifier(query.toLabel, "to label");
    const min = assertHops(query.minHops, "minHops") ?? 1;
    const max = assertHops(query.maxHops, "maxHops") ?? 5;
    if (min > max) throw new Error(`traverse: minHops ${min} exceeds maxHops ${max}`);
    assertNonNegativeInt(query.limit, "limit");
    const direction: EdgeDirection = query.direction ?? "out";
    let rel: string;
    if (query.table !== undefined) {
      // Registered tables only — keeps the rel type a known identifier.
      this.resolve(query.table);
      rel = `:${query.table}`;
    } else {
      rel = "";
    }
    const hops = min === max ? `${min}` : `${min}..${max}`;
    const to = query.toLabel !== undefined ? `(b:${query.toLabel})` : `(b)`;
    const pattern =
      direction === "in"
        ? `(a:${query.fromLabel} {id: $from})<-[e${rel}*${hops}]-${to}`
        : direction === "both"
          ? `(a:${query.fromLabel} {id: $from})-[e${rel}*${hops}]-${to}`
          : `(a:${query.fromLabel} {id: $from})-[e${rel}*${hops}]->${to}`;
    const params: GraphParams = { from: query.fromId };
    // e binds to a list on variable-length paths, hence ALL semantics.
    const filters = Object.entries(query.where ?? {});
    if (query.table !== undefined && filters.length > 0) {
      this.edgeWhere(this.resolve(query.table), query.where, params, "w", "x");
    } else if (filters.length > 0) {
      for (const [key] of filters) assertCypherIdentifier(key, "traverse where key");
    }
    const where = filters
      .map(([key, value], i) => {
        if (value === null) return `ALL(x IN e WHERE x.${key} IS NULL)`;
        const param = `w_${i}`;
        if (Array.isArray(value)) {
          params[param] = value as GraphParams[string];
          return `ALL(x IN e WHERE x.${key} IN $${param})`;
        }
        params[param] = value;
        return `ALL(x IN e WHERE x.${key} = $${param})`;
      })
      .join(" AND ");
    const rows = await this.db.query(
      [
        `MATCH ${pattern}`,
        where.length > 0 ? `WHERE ${where}` : "",
        `RETURN DISTINCT b.id AS to_id, length(e) AS hops${query.limit !== undefined ? ` LIMIT ${query.limit}` : ""};`,
      ]
        .filter((part) => part.length > 0)
        .join(" "),
      params
    );
    return rows;
  }
}
