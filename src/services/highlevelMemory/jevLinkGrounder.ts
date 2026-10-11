import { choice, noul, TypeSafeClient } from "@typesafe-ai/sdk";
import type { MemoryEdge, MemoryNode } from "../../models/memory.ts";
import type { GroundedLink, LinkGrounder } from "./linkGrounder.ts";

export type JevLinkGrounderOptions = {
  /** Model override; defaults to the client's `jev-latest`. */
  model?: string;
  /** Drop proposals whose relation Choice is less confident than this. */
  minConfidence?: number;
};

// The relation is a closed set: the four memory edge kinds, plus `none` so the
// model can decline instead of being forced to pick a link. Direction rides on
// a companion Noul; same_referent / conflict surface the why.
const RELATION_QUESTION =
  "How does memory `a` relate to memory `b`? Choose `none` when there is no defensible link.";

const RELATION_CRITERIA = {
  supports: "`a` and `b` point to the same pattern: `a` supports `b`.",
  contradicts: "`a` and `b` conflict.",
  related_to: "`a` and `b` share a loose thematic or semantic link.",
  evokes: "`a` tends to produce or trigger `b` (causal).",
  none: "No defensible link between `a` and `b`.",
} as const;

// Default grounded model for proposeLinks. One TypeSafe request per candidate
// pair: a Choice for the relation kind, plus Nouls for direction and evidence.
// The API key is read lazily so building the service never needs credentials.
export class JevLinkGrounder implements LinkGrounder {
  private readonly model?: string;
  private readonly minConfidence: number;
  private client: TypeSafeClient | null = null;

  private constructor(options: JevLinkGrounderOptions) {
    this.model = options.model;
    this.minConfidence = options.minConfidence ?? 0;
  }

  static create(options: JevLinkGrounderOptions = {}): JevLinkGrounder {
    return new JevLinkGrounder(options);
  }

  private getClient(): TypeSafeClient {
    if (!this.client) {
      try {
        this.client = new TypeSafeClient();
      } catch (error) {
        throw new Error(
          "JevLinkGrounder: cannot create the TypeSafe client — set TYPESAFE_API_KEY in the environment.",
          { cause: error }
        );
      }
    }
    return this.client;
  }

  async ground(a: MemoryNode, b: MemoryNode): Promise<GroundedLink | null> {
    const response = await this.getClient().systemOne({
      state: {
        a: { id: a.id, type: a.type, description: a.description },
        b: { id: b.id, type: b.type, description: b.description },
      },
      questions: {
        relation: choice(RELATION_QUESTION, RELATION_CRITERIA),
        same_referent: noul("Do `a` and `b` refer to the same underlying thing?"),
        conflict: noul("Do `a` and `b` contradict each other?"),
        direction: noul("Is the relation directed from `a` to `b` (rather than from `b` to `a`)?"),
        // Which side to keep if they conflict — the agent still adjudicates.
        favored: noul(
          "Is memory `a` better supported than memory `b` (keep `a` over `b` if they conflict)?"
        ),
      },
      ...(this.model ? { model: this.model } : {}),
    });

    const { relation, same_referent, conflict, direction, favored } = response.answers;
    if (relation.choice === "none" || relation.confidence < this.minConfidence) {
      return null;
    }

    // Direction is symmetric-agnostic: a near-0.5 split still resolves to one
    // side, matching the single from -> to the graph stores.
    const forward = direction.noul >= 0.5;
    const from = forward ? a : b;
    const to = forward ? b : a;

    const evidence: Record<string, number> = {
      same_referent: same_referent.noul,
      conflict: conflict.noul,
      direction: direction.noul,
      favored: favored.noul,
    };
    for (const [label, probability] of Object.entries(relation.probabilities)) {
      evidence[`relation_${label}`] = probability;
    }

    return {
      fromId: from.id,
      toId: to.id,
      edgeType: relation.choice as MemoryEdge["type"],
      confidence: relation.confidence,
      evidence,
      ...(relation.choice === "contradicts"
        ? { favoredId: favored.noul >= 0.5 ? a.id : b.id }
        : {}),
    };
  }
}
