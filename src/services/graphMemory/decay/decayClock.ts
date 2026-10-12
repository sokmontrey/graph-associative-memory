// Global decay clock: the running log-accumulators every row settles against.
//
// One row (id 'global') in the MemoryDecayClock table holds three log-sums —
// one per decay axis — plus a sequence number. Each operation advances the
// clock by log(factor) in O(1); rows store their own watermark (the clock
// values at their last settle) and apply only their personal backlog lazily
// on read (see decaySettler.ts). Heterogeneous per-op rates compose freely:
// the clock is just the running sum of whatever each op contributed.
//
// Log-space (not products) so thousands of 0.999 ops drift linearly negative
// instead of underflowing toward 0.

import type { GraphDbRepo } from "../../../repos/graphDb/index.ts";
import { factorToDelta } from "./decayMath.ts";
import type { AxisFactors } from "./decayFactors.ts";

export const DECAY_CLOCK_LABEL = "MemoryDecayClock";
export const DECAY_CLOCK_ID = "global";

export interface DecayClockState {
  lImportance: number;
  lValidity: number;
  lStrength: number;
  seq: number;
}

export class DecayClock {
  private readonly db: GraphDbRepo;
  private state: DecayClockState;

  private constructor(db: GraphDbRepo, state: DecayClockState) {
    this.db = db;
    this.state = state;
  }

  /** Load the persisted clock, creating the global row on first run. */
  static async load(db: GraphDbRepo): Promise<DecayClock> {
    const row = await db.queryOne(
      `MERGE (c:${DECAY_CLOCK_LABEL} {id: $id}) ` +
        `ON CREATE SET c.l_importance = 0.0, c.l_validity = 0.0, c.l_strength = 0.0, c.seq = 0.0 ` +
        `RETURN c.l_importance AS l_importance, c.l_validity AS l_validity, ` +
        `c.l_strength AS l_strength, c.seq AS seq;`,
      { id: DECAY_CLOCK_ID }
    );
    const num = (value: unknown, name: string): number => {
      const n = Number(value ?? 0);
      if (!Number.isFinite(n) || n > 0) {
        throw new Error(`DecayClock.load: ${name} must be a non-positive finite number, got ${value}`);
      }
      return n;
    };
    const seq = Number(row?.["seq"] ?? 0);
    return new DecayClock(db, {
      lImportance: num(row?.["l_importance"], "l_importance"),
      lValidity: num(row?.["l_validity"], "l_validity"),
      lStrength: num(row?.["l_strength"], "l_strength"),
      seq: Number.isFinite(seq) ? seq : 0,
    });
  }

  snapshot(): DecayClockState {
    return { ...this.state };
  }

  get seq(): number {
    return this.state.seq;
  }

  /**
   * Advance the clock by one operation's factors (O(1), one write).
   * Returns the log-deltas applied (each <= 0).
   */
  async advance(factors: AxisFactors): Promise<{ dImportance: number; dValidity: number; dStrength: number }> {
    const dImportance = factorToDelta(factors.importance);
    const dValidity = factorToDelta(factors.validity);
    const dStrength = factorToDelta(factors.strength);
    const next: DecayClockState = {
      lImportance: this.state.lImportance + dImportance,
      lValidity: this.state.lValidity + dValidity,
      lStrength: this.state.lStrength + dStrength,
      seq: this.state.seq + 1,
    };
    await this.db.query(
      `MATCH (c:${DECAY_CLOCK_LABEL} {id: $id}) ` +
        `SET c.l_importance = $lI, c.l_validity = $lV, c.l_strength = $lS, c.seq = $seq;`,
      {
        id: DECAY_CLOCK_ID,
        lI: next.lImportance,
        lV: next.lValidity,
        lS: next.lStrength,
        seq: next.seq,
      }
    );
    this.state = next;
    return { dImportance, dValidity, dStrength };
  }
}
