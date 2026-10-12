// Lazy settle logic: turn a row's watermark backlog into a concrete patch.
//
// Pure functions — no DB. The caller (GraphMemoryService) fetches rows, runs
// them through here against the current clock snapshot, and persists only the
// patches that are due. Invalidated rows are never settled here; callers skip
// them so tombstones stay frozen.

import type { DecayClockState } from "./decayClock.ts";
import { pendingFactor, shouldSettle } from "./decayMath.ts";

/**
 * Watermark fields stored per node (see models/memory.ts). Snake_case to match
 * the MemoryNode columns (same convention as last_reinforce / superseded_by).
 */
export interface NodeDecayWatermarks {
  decay_l_importance: number;
  decay_l_validity: number;
}

export interface SettledNodePatch extends NodeDecayWatermarks {
  importance: number;
  validity: number;
}

/**
 * Compute the settled values for an active node. Returns null when the
 * backlog is below the write threshold (leave row and watermark untouched so
 * the backlog keeps accumulating until it is worth a write).
 */
export function settleNode(
  current: { importance: number; validity: number } & Partial<NodeDecayWatermarks>,
  clock: DecayClockState
): SettledNodePatch | null {
  const wI = current.decay_l_importance ?? 0;
  const wV = current.decay_l_validity ?? 0;
  if (!shouldSettle(clock.lImportance, wI) && !shouldSettle(clock.lValidity, wV)) {
    return null;
  }
  return {
    importance: current.importance * pendingFactor(clock.lImportance, wI),
    validity: current.validity * pendingFactor(clock.lValidity, wV),
    decay_l_importance: clock.lImportance,
    decay_l_validity: clock.lValidity,
  };
}

/**
 * Watermark-only patch for rows the current op tombstones or reinstates:
 * fast-forward their clock without decaying them. Returns DB patch-shaped keys
 * so call sites can spread it straight into an update.
 */
export function exemptNode(clock: DecayClockState): {
  decay_l_importance: number;
  decay_l_validity: number;
} {
  return { decay_l_importance: clock.lImportance, decay_l_validity: clock.lValidity };
}

/** Watermark field stored per edge (matches the MemoryEdge column). */
export interface EdgeDecayWatermark {
  decay_l_strength: number;
}

export interface SettledEdgePatch extends EdgeDecayWatermark {
  strength: number;
}

export function settleEdge(
  current: { strength: number } & Partial<EdgeDecayWatermark>,
  clock: DecayClockState
): SettledEdgePatch | null {
  const wS = current.decay_l_strength ?? 0;
  if (!shouldSettle(clock.lStrength, wS)) return null;
  return {
    strength: current.strength * pendingFactor(clock.lStrength, wS),
    decay_l_strength: clock.lStrength,
  };
}

export function exemptEdge(clock: DecayClockState): { decay_l_strength: number } {
  return { decay_l_strength: clock.lStrength };
}
