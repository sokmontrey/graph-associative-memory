// Per-operation decay rates for the lazy (log-accumulator) decay scheme.
//
// Every memory operation advances a global log-clock by log(factor); rows
// settle their own backlog lazily on read (see decayClock.ts / decaySettler.ts).
// Factors stay near 1.0: reads barely erode, writes erode a little more, and
// the manual `tick` keeps the legacy big-hammer values for explicit bulk decay.
//
// This file is pure config: no DB, no imports from services (only a type-only
// op name), easily unit-tested.

export interface AxisFactors {
  /** Multiplier applied to node importance per op. */
  importance: number;
  /** Multiplier applied to node validity per op. */
  validity: number;
  /** Multiplier applied to edge strength per op. */
  strength: number;
}

/** Every operation that can advance the decay clock, including reads. */
export type DecayOpName =
  | "getTopImportance"
  | "recall"
  | "remember"
  | "proposeLinks"
  | "connect"
  | "invalidate"
  | "reinstate"
  | "resolveContradiction"
  | "challenge"
  | "corroborate"
  | "reinforce"
  | "inspect"
  | "stats"
  | "setValidity"
  | "tick";

function factors(importance: number, validity: number, strength: number): AxisFactors {
  for (const [name, value] of [
    ["importance", importance],
    ["validity", validity],
    ["strength", strength],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0 || value > 1) {
      throw new Error(`DECAY_FACTORS: ${name} must be in (0, 1], got ${value}`);
    }
  }
  return { importance, validity, strength };
}

export const DECAY_FACTORS: Record<DecayOpName, AxisFactors> = {
  // Growth ops: new nodes/edges enter at full salience, so erode the rest a
  // touch more to keep surfacing competitive.
  remember: factors(0.995, 0.999, 0.995),
  connect: factors(0.995, 0.999, 0.995),
  resolveContradiction: factors(0.995, 0.999, 0.995),
  // Strengthening ops: the touched rows are exempted (fast-forwarded) by the
  // caller, so the net effect on them stays positive.
  reinforce: factors(0.998, 0.9995, 0.998),
  corroborate: factors(0.998, 1.0, 0.998),
  recall: factors(0.998, 1.0, 0.998),
  // Belief ops manage validity explicitly; don't double-decay it here.
  challenge: factors(0.997, 1.0, 0.997),
  invalidate: factors(0.997, 1.0, 0.997),
  reinstate: factors(0.997, 1.0, 0.997),
  // Pure reads: barely erode salience, never touch belief.
  getTopImportance: factors(0.999, 1.0, 0.999),
  proposeLinks: factors(0.999, 1.0, 0.999),
  inspect: factors(0.999, 1.0, 0.999),
  stats: factors(0.999, 1.0, 0.999),
  // Direct validity write: no decay at all.
  setValidity: factors(1.0, 1.0, 1.0),
  // Manual big hammer from the dashboard: legacy eager-tick values.
  tick: factors(0.9, 0.98, 0.9),
};

export function factorsForOp(op: string): AxisFactors {
  return DECAY_FACTORS[op as DecayOpName] ?? factors(0.999, 1.0, 0.999);
}
