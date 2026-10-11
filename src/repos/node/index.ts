import type { GraphRow } from "../graphDb/index.ts";

export type NodeScalar = string | number | boolean | null;
export type NodeFilterValue = NodeScalar | NodeScalar[];

export type NodeFilter = {
  /** Equality map: scalar → `=`, array → `IN`, null → `IS NULL`. */
  where?: Record<string, NodeFilterValue>;
  orderBy?: string;
  orderDir?: "ASC" | "DESC";
  limit?: number;
  skip?: number;
};

export interface NodeRepo<TNode, TUpsert extends { id: string }, TUpdate> {
  /** MERGE on id. Present non-null fields overwrite on match; absent fields keep. */
  upsert(input: TUpsert): Promise<TNode>;
  upsertMany(inputs: TUpsert[]): Promise<TNode[]>;
  findById(id: string): Promise<TNode | null>;
  exists(id: string): Promise<boolean>;
  count(filter?: NodeFilter): Promise<number>;
  findAll(filter?: NodeFilter): Promise<TNode[]>;
  /** Exact-set patch: present keys write (null clears), absent keys keep. */
  update(id: string, patch: TUpdate): Promise<TNode | null>;
  /** DETACH DELETE. Returns true when a node existed. */
  remove(id: string): Promise<boolean>;
}

export type NodeRepoConfig<TNode, TUpsert extends { id: string }, TUpdate> = {
  /** Node table label, e.g. "ConceptNode". */
  label: string;
  /** All readable/writable properties, including "id". Doubles as the write allowlist. */
  fields: readonly string[];
  map: (row: GraphRow, alias?: string) => TNode;
  /** Property auto-set to now on CREATE (when present in fields). */
  createdAtField?: string;
};

export { LadybugNodeRepo } from "./ladybugNodeRepo.ts";
