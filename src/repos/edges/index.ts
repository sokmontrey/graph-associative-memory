import type { GraphRow } from "../graphDb/index.ts";

export type EdgeScalar = string | number | boolean | Date | null;
export type EdgeProps = Record<string, EdgeScalar | undefined>;
export type EdgeWhereValue = EdgeScalar | EdgeScalar[];
export type EdgeDirection = "out" | "in" | "both";

/** A registered relationship table. Unknown tables are rejected at runtime. */
export type EdgeTableConfig = {
  table: string;
  fromLabel: string;
  toLabel: string;
  /** Edge properties, readable and writable. */
  props: readonly string[];
  /** Property auto-set to now on create (when present in props). */
  createdAtField?: string;
};

export type EdgeCreate = {
  table: string;
  fromId: string;
  toId: string;
  props?: EdgeProps;
};

export type EdgeEndpoints = {
  table: string;
  fromId: string;
  toId: string;
};

export type EdgeFilter = {
  table: string;
  fromId?: string;
  toId?: string;
  /** Edge-property filters: scalar → `=`, array → `IN`, null → `IS NULL`. */
  where?: Record<string, EdgeWhereValue>;
  direction?: EdgeDirection;
  orderBy?: string;
  orderDir?: "ASC" | "DESC";
  limit?: number;
  skip?: number;
};

/** One-hop join: the neighbor node's props plus the connecting edge's props. */
export type NeighborQuery = {
  table: string;
  fromId: string;
  direction?: EdgeDirection;
  /** Neighbor node properties to return (as `m_<prop>`). */
  nodeProps: readonly string[];
  /** Edge properties to return (as `e_<prop>`). Defaults to all registered. */
  edgeProps?: readonly string[];
  where?: Record<string, EdgeWhereValue>;
  limit?: number;
};

export type TraverseQuery = {
  fromLabel: string;
  fromId: string;
  /** Registered table to restrict the rel type. Omit for any type. */
  table?: string;
  toLabel?: string;
  direction?: EdgeDirection;
  minHops?: number;
  maxHops?: number;
  /** Edge filters along the path (ALL semantics). */
  where?: Record<string, EdgeWhereValue>;
  limit?: number;
};

export interface EdgeRepo {
  /** MATCH both endpoints, CREATE the edge. Throws when an endpoint is missing. */
  create(input: EdgeCreate): Promise<GraphRow>;
  /** Rows carry `from_id`, `to_id`, plus `e_<prop>` for each registered prop. */
  list(filter: EdgeFilter): Promise<GraphRow[]>;
  count(filter: EdgeFilter): Promise<number>;
  /** Exact-set patch on every edge matching table + endpoints (+ where). */
  update(
    key: EdgeEndpoints,
    patch: EdgeProps,
    where?: Record<string, EdgeWhereValue>
  ): Promise<GraphRow[]>;
  /**
   * DELETE edges. Requires at least one of fromId / toId / where so a whole
   * table cannot be wiped by accident. Returns the deleted count.
   */
  remove(filter: EdgeFilter): Promise<number>;
  /** One-hop neighbor read with a caller-supplied row mapper. */
  neighbors<T>(query: NeighborQuery, map: (row: GraphRow) => T): Promise<T[]>;
  /** Variable-length path read. Rows carry `to_id` and `hops`. */
  traverse(query: TraverseQuery): Promise<GraphRow[]>;
}

export { LadybugEdgeRepo } from "./ladybugEdgeRepo.ts";
