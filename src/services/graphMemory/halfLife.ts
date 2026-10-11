// Half-life math for memory nodes/edges. Pure functions — no DB, easily
// unit-tested. Callers pass their own reinforce strength: different API
// functions strengthen differently (see REINFORCE_* below).

export const HALF_LIFE = {
  MAX: 1.0,
  INITIAL_IMPORTANCE: 1.0,
  INITIAL_STRENGTH: 1.0,
  INITIAL_VALIDITY: 1.0,
  DECAY_FACTOR: 0.9,
  // Belief erodes far slower than salience: a memory can become rarely-shown
  // without becoming disbelieved. Decisive doubt comes from `challenge` /
  // `invalidate`, not from this.
  VALIDITY_DECAY_FACTOR: 0.98,
  // Default strengths for the explicit reinforce* API.
  REINFORCE_NODE_STRENGTH: 0.1,
  REINFORCE_EDGE_STRENGTH: 0.15,
  // Validity moves for corroborate / challenge.
  CORROBORATE_BONUS: 0.2,
  CHALLENGE_PENALTY: 0.5,
  VALIDITY_FLOOR: 0.0,
} as const;

export function reinforceValue(current: number, strength: number): number {
  if (!Number.isFinite(current)) {
    throw new Error(`reinforceValue: current must be finite, got ${current}`);
  }
  if (!Number.isFinite(strength) || strength < 0) {
    throw new Error(`reinforceValue: strength must be a non-negative number, got ${strength}`);
  }
  return Math.min(HALF_LIFE.MAX, current + strength);
}

export function decayValue(current: number): number {
  if (!Number.isFinite(current)) {
    throw new Error(`decayValue: current must be finite, got ${current}`);
  }
  return current * HALF_LIFE.DECAY_FACTOR;
}

export function decayValidity(current: number): number {
  if (!Number.isFinite(current)) {
    throw new Error(`decayValidity: current must be finite, got ${current}`);
  }
  return Math.max(HALF_LIFE.VALIDITY_FLOOR, current * HALF_LIFE.VALIDITY_DECAY_FACTOR);
}

export function challengeValidity(current: number): number {
  if (!Number.isFinite(current)) {
    throw new Error(`challengeValidity: current must be finite, got ${current}`);
  }
  return Math.max(HALF_LIFE.VALIDITY_FLOOR, current * HALF_LIFE.CHALLENGE_PENALTY);
}

export function corroborateValidity(current: number): number {
  if (!Number.isFinite(current)) {
    throw new Error(`corroborateValidity: current must be finite, got ${current}`);
  }
  return Math.min(HALF_LIFE.MAX, current + HALF_LIFE.CORROBORATE_BONUS);
}
