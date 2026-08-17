/**
 * Axis scaling. Kept separate from the chart component so the tick arithmetic —
 * the part that is easy to get subtly wrong — can be pinned by tests.
 */

/** Steps that read as round numbers, per decade. */
const STEPS = [1, 2, 2.5, 5, 10]

export interface TickOptions {
  target?: number
  /**
   * Stretch the axis to the zero baseline. On by default: these charts put
   * assets, debts and net worth on one axis, and debt sits near zero and can
   * cross it, so a floating baseline would misstate the size of a change.
   *
   * Turn it off for a series that never approaches zero and whose variation is
   * the point — a zero baseline flattens it to a straight line.
   */
  includeZero?: boolean
}

/** Ticks at round values covering [min, max]. */
export function niceTicks(min: number, max: number, options: TickOptions = {}): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  const { target = 5, includeZero = true } = options

  let low = includeZero ? Math.min(min, 0) : Math.min(min, max)
  let high = includeZero ? Math.max(max, 0) : Math.max(min, max)

  if (low === high) {
    // A flat series still needs an axis with height, or the line sits on an edge.
    if (low === 0) return [0, 1]
    low = Math.min(0, low)
    high = Math.max(0, high)
  }

  const rough = (high - low) / Math.max(1, target)
  const decade = 10 ** Math.floor(Math.log10(rough))
  const step = (STEPS.find((candidate) => candidate * decade >= rough) ?? 10) * decade

  const first = Math.floor(low / step) * step
  const last = Math.ceil(high / step) * step

  const ticks: number[] = []
  // Multiply rather than accumulate: adding a fractional step 20 times drifts.
  for (let index = 0; first + index * step <= last + step / 1000; index++) {
    ticks.push(Number((first + index * step).toPrecision(12)))
  }
  return ticks
}

export interface Scale {
  min: number
  max: number
  /** Value → 0–1, where 0 is the bottom of the plot. */
  (value: number): number
}

/** A linear scale over the tick range, so marks line up with the gridlines. */
export function linearScale(ticks: readonly number[]): Scale {
  const min = ticks[0] ?? 0
  const max = ticks[ticks.length - 1] ?? 1
  const span = max - min || 1
  const scale = ((value: number) => (value - min) / span) as Scale
  scale.min = min
  scale.max = max
  return scale
}
