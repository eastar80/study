import { describe, expect, it } from 'vitest'
import { linearScale, niceTicks } from './scale'

describe('niceTicks', () => {
  it('lands on round values', () => {
    const ticks = niceTicks(0, 4300)
    expect(ticks[0]).toBe(0)
    expect(ticks.at(-1)!).toBeGreaterThanOrEqual(4300)
    // Every tick is a whole multiple of the step.
    const step = ticks[1]! - ticks[0]!
    expect(ticks.every((tick) => Math.abs(tick % step) < 1e-6)).toBe(true)
  })

  it('includes zero when the range crosses it', () => {
    // Net worth was negative in the early years; hiding the baseline would
    // misstate how big the recovery was.
    expect(niceTicks(-2000, 5000)).toContain(0)
  })

  it('stretches to zero even when the whole range is positive', () => {
    expect(niceTicks(3000, 5000)[0]).toBe(0)
  })

  it('stretches up to zero when the whole range is negative', () => {
    const ticks = niceTicks(-5000, -3000)
    expect(ticks.at(-1)).toBe(0)
    expect(ticks[0]).toBeLessThanOrEqual(-5000)
  })

  it('can be told to leave the baseline out, for a series far from zero', () => {
    // Net worth swinging 600M–680M is a flat line on a zero baseline.
    const ticks = niceTicks(600_000_000, 680_000_000, { includeZero: false })
    expect(ticks[0]).toBeGreaterThan(0)
    expect(ticks[0]).toBeLessThanOrEqual(600_000_000)
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(680_000_000)
  })

  it('produces roughly the requested number of ticks', () => {
    for (const [min, max] of [
      [0, 1],
      [0, 7],
      [0, 4_300],
      [0, 677_000_000],
      [-120_000_000, 900_000_000],
    ] as const) {
      const ticks = niceTicks(min, max)
      expect(ticks.length, `${min}..${max}`).toBeGreaterThanOrEqual(3)
      expect(ticks.length, `${min}..${max}`).toBeLessThanOrEqual(9)
    }
  })

  it('gives a flat series an axis with height', () => {
    // Otherwise the line sits exactly on an edge and reads as missing.
    expect(niceTicks(0, 0)).toEqual([0, 1])
    expect(niceTicks(500, 500).length).toBeGreaterThan(1)
  })

  it('does not drift on fractional steps', () => {
    // Accumulating a step would leave 0.30000000000000004 in the labels.
    const ticks = niceTicks(0, 1)
    expect(ticks.every((tick) => String(tick).length <= 4)).toBe(true)
  })

  it('returns nothing for a non-finite range instead of looping', () => {
    expect(niceTicks(NaN, 10)).toEqual([])
    expect(niceTicks(0, Infinity)).toEqual([])
  })
})

describe('linearScale', () => {
  it('maps the tick range onto 0–1 from the bottom up', () => {
    const scale = linearScale([0, 50, 100])
    expect(scale(0)).toBe(0)
    expect(scale(50)).toBeCloseTo(0.5)
    expect(scale(100)).toBe(1)
  })

  it('places zero correctly on an axis that crosses it', () => {
    const scale = linearScale([-100, 0, 100])
    expect(scale(0)).toBeCloseTo(0.5)
    expect(scale(-100)).toBe(0)
  })

  it('survives a degenerate range without dividing by zero', () => {
    expect(Number.isFinite(linearScale([5]) (5))).toBe(true)
  })
})
