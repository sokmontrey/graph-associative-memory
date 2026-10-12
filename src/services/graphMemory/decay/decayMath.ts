// Log-space math for lazy decay. Pure functions — no DB, easily unit-tested.
//
// Why log-space: the global clock is a running product of per-op factors.
// After thousands of ops at 0.999 that product underflows toward 0 and the
// pending ratio (global / watermark) becomes 0/0. Sums of log(f) drift
// linearly negative instead — numerically safe forever — and the pending
// factor is recovered with exp(delta).

/** Convert a (0, 1] factor into its log-delta (<= 0). */
export function factorToDelta(factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0 || factor > 1) {
    throw new Error(`factorToDelta: factor must be in (0, 1], got ${factor}`);
  }
  return Math.log(factor);
}

/** Pending multiplier for a row whose watermark lags the global clock. */
export function pendingFactor(globalL: number, watermarkL: number): number {
  const delta = globalL - watermarkL;
  if (!Number.isFinite(delta)) {
    throw new Error(`pendingFactor: non-finite delta ${delta}`);
  }
  if (delta >= 0) return 1;
  return Math.exp(delta);
}

// Below this |deltaL| the decay rounds to ~1 anyway; skipping the write lets
// small backlogs accumulate until they are worth persisting. 1e-9 ≈ ten
// no-op reads at 0.999 before a write becomes due.
export const SETTLE_EPSILON = 1e-9;

/** True when the backlog is large enough to justify a DB write. */
export function shouldSettle(globalL: number, watermarkL: number): boolean {
  return globalL - watermarkL < -SETTLE_EPSILON;
}

/** Settle one half-life value against the clock. */
export function settleValue(current: number, globalL: number, watermarkL: number): number {
  if (!Number.isFinite(current)) {
    throw new Error(`settleValue: current must be finite, got ${current}`);
  }
  return current * pendingFactor(globalL, watermarkL);
}
