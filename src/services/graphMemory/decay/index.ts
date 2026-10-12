// Barrel for the decay module: policy (rates) + math (log-space) + clock
// (global accumulator) + settler (per-row lazy patches).
export { DECAY_FACTORS, factorsForOp, type AxisFactors, type DecayOpName } from "./decayFactors.ts";
export {
  SETTLE_EPSILON,
  factorToDelta,
  pendingFactor,
  settleValue,
  shouldSettle,
} from "./decayMath.ts";
export { DecayClock, DECAY_CLOCK_ID, DECAY_CLOCK_LABEL, type DecayClockState } from "./decayClock.ts";
export {
  exemptEdge,
  exemptNode,
  settleEdge,
  settleNode,
  type EdgeDecayWatermark,
  type NodeDecayWatermarks,
  type SettledEdgePatch,
  type SettledNodePatch,
} from "./decaySettler.ts";
