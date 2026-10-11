import type { MemoryEdge, MemoryNode } from "../../models/memory.ts";

// A link the grounded model is willing to defend: endpoints, relation kind,
// and the grounding probabilities behind the call. `evidence` carries the
// Noul answers (e.g. same_referent / conflict / direction) so the "why" can be
// written without another model call.
export interface GroundedLink {
  fromId: string;
  toId: string;
  edgeType: MemoryEdge["type"];
  confidence: number;
  evidence: Record<string, number>;
  // When edgeType is "contradicts", which side the evidence favors (a memory
  // id). The agent still makes the final adjudication call.
  favoredId?: string;
}

// The grounded model behind proposeLinks. Given two memories it returns the
// relation it can justify, or null when there is no defensible link. Swap the
// implementation (Jev/TypeSafe by default) without touching the service.
export interface LinkGrounder {
  ground(a: MemoryNode, b: MemoryNode): Promise<GroundedLink | null>;
}
