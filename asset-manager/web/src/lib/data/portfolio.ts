/**
 * Aggregates the securities workbook into what the portfolio screen shows.
 *
 * Like `dashboard.ts`, this stores nothing of its own — every figure is derived
 * from `portfolioNavs` and `holdings`, so it cannot drift from what was imported.
 *
 * Costs come out of the workbook in each holding's own currency, so anything that
 * adds them across holdings takes an exchange-rate map. Live prices still belong
 * to the quote relay; what the workbook already knows is the whole-portfolio
 * performance history and the composition at cost.
 */

import type { CurrencyCode, Holding, PortfolioNav } from './model'
import { isCashLike, krwPerUnit } from '../quotes/valuation'

export interface NavSummary {
  ym: string
  /** Month-end valuation of the whole portfolio. */
  marketValue: number
  nav: number
  /** Net money put in since the first month held. */
  cumulativeIn: number
  /** marketValue − cumulativeIn: what the portfolio made, in won. */
  cumulativeProfit: number
  /** Time-weighted return since the first month, in percent. */
  returnPct: number
  /** The benchmark over the same span, or null when it is not in the sheet. */
  benchmarkReturnPct: number | null
  /** returnPct − benchmarkReturnPct, in percentage points. */
  excessPct: number | null
}

/**
 * Summary as of the last month held.
 *
 * Return comes from the 기준가, not from profit over deposits: the 기준가 is a
 * unit price that only moves with performance, so it is unaffected by the timing
 * of deposits. Dividing profit by deposits would flatter or punish the portfolio
 * for when money happened to arrive.
 */
export function summariseNavs(navs: readonly PortfolioNav[]): NavSummary | null {
  if (navs.length === 0) return null

  const ordered = [...navs].sort((a, b) => a.ym.localeCompare(b.ym))
  const first = ordered[0]!
  const last = ordered[ordered.length - 1]!

  const cumulativeIn = ordered.reduce((sum, month) => sum + month.cashFlow, 0)
  const returnPct = first.nav === 0 ? 0 : (last.nav / first.nav - 1) * 100

  const benchmarkReturnPct =
    first.benchmark === undefined || last.benchmark === undefined || first.benchmark === 0
      ? null
      : (last.benchmark / first.benchmark - 1) * 100

  return {
    ym: last.ym,
    marketValue: last.marketValue,
    nav: last.nav,
    cumulativeIn,
    cumulativeProfit: last.marketValue - cumulativeIn,
    returnPct,
    benchmarkReturnPct,
    excessPct: benchmarkReturnPct === null ? null : returnPct - benchmarkReturnPct,
  }
}

/** The window of up to `count` months ending at the last one held. */
export function recentNavs(navs: readonly PortfolioNav[], count: number): PortfolioNav[] {
  const ordered = [...navs].sort((a, b) => a.ym.localeCompare(b.ym))
  return ordered.slice(Math.max(0, ordered.length - count))
}

/**
 * Rebases a series so it starts at 100.
 *
 * The 기준가 starts at 1000 and the KOSPI sits in the thousands, so plotting them
 * raw would need two y-scales — and the alignment of two scales is arbitrary, so
 * the chart would invent a correlation that is not in the data. Indexing both to
 * a common base puts them on one honest axis.
 */
export function indexToBase(values: readonly (number | null | undefined)[]): (number | null)[] {
  const base = values.find((value): value is number => typeof value === 'number' && value !== 0)
  if (base === undefined) return values.map(() => null)
  return values.map((value) => (typeof value === 'number' ? (value / base) * 100 : null))
}

/**
 * Purchase cost of a position, **in the holding's own currency** — dollars for a
 * dollar holding, yen for a yen one.
 *
 * The sheet's own 매입원가 wins. Falling back to 수량 × 단가 is only for a blank
 * cell, and it is wrong for yen — the 단가 column carries 100× there — so the
 * importer reports those rows rather than letting the fallback pass unnoticed.
 *
 * Cash never reads 매입원가. Its 단가 cell holds an exchange rate rather than a
 * price, so the two columns do not share a unit the way a stock's do. Cash also
 * does not appreciate, which means cost and market value are the same number, so
 * `수량 × 1` is right for both without knowing anything about 매입원가.
 */
export function costOf(holding: Holding): number {
  if (isCashLike(holding)) return holding.quantity
  return holding.costNative ?? holding.costKrw ?? holding.quantity * holding.avgPrice
}

/**
 * Purchase cost in won, at today's rate. Null when the rate is missing.
 *
 * Null rather than 0: a cost silently dropped from a total shrinks the total
 * without saying so, and one converted at a made-up rate of 1 is worse.
 */
export function costKrwOf(
  holding: Holding,
  rates: ReadonlyMap<CurrencyCode, number>,
): number | null {
  const rate = krwPerUnit(holding.currency, rates)
  return rate === null ? null : costOf(holding) * rate
}

/**
 * Purchase price per share, **in the holding's own currency** — the 단가 column
 * with its scale applied, which is what undoes the yen 100×.
 *
 * Cash is one unit of its own currency, matching its current price. Its 단가 is an
 * exchange rate, and showing that in a price column would read as a share price.
 */
export function avgPriceNative(holding: Holding): number {
  if (isCashLike(holding)) return 1
  return holding.avgPrice * (holding.priceScale ?? 1)
}

/** Account owners present, in first-seen order. 계좌주 filtering is optional. */
export function owners(holdings: readonly Holding[]): string[] {
  const seen: string[] = []
  for (const holding of holdings) {
    if (holding.owner !== '' && !seen.includes(holding.owner)) seen.push(holding.owner)
  }
  return seen
}

export function byOwner(holdings: readonly Holding[], owner: string | null): Holding[] {
  return owner === null ? [...holdings] : holdings.filter((holding) => holding.owner === owner)
}

export interface CostSlice {
  key: string
  /** Won. */
  cost: number
  /** Fraction of the total, 0–1. */
  share: number
}

export interface Composition {
  /** Won, over the holdings that could be converted. */
  total: number
  slices: CostSlice[]
  /**
   * Holdings left out because their currency had no rate, by name. A composition
   * that quietly drops a position redraws every share without saying why.
   */
  unconverted: string[]
}

/**
 * Composition at cost in won, by any of the holding's dimensions.
 *
 * One bar on one scale, so the shares mean something — which needs every cost in
 * the same unit, and the costs come out of the sheet in each holding's own
 * currency. Converting needs today's rate; a holding whose rate is missing is
 * reported rather than added as 0.
 */
export function compositionAt(
  holdings: readonly Holding[],
  dimension: 'style' | 'region' | 'currency' | 'account' | 'owner',
  rates: ReadonlyMap<CurrencyCode, number>,
): Composition {
  const byKey = new Map<string, number>()
  const unconverted: string[] = []

  for (const holding of holdings) {
    const cost = costKrwOf(holding, rates)
    if (cost === null) {
      if (costOf(holding) !== 0) unconverted.push(holding.name)
      continue
    }
    if (cost === 0) continue
    const key = holding[dimension] === '' ? '미분류' : String(holding[dimension])
    byKey.set(key, (byKey.get(key) ?? 0) + cost)
  }

  const total = [...byKey.values()].reduce((sum, cost) => sum + cost, 0)
  return {
    total,
    slices: [...byKey.entries()]
      .map(([key, cost]) => ({ key, cost, share: total === 0 ? 0 : cost / total }))
      .sort((a, b) => b.cost - a.cost),
    unconverted,
  }
}

/** Distinct values of a dimension across all holdings, for stable colour slots. */
export function dimensionKeys(
  holdings: readonly Holding[],
  dimension: 'style' | 'region' | 'currency' | 'account' | 'owner',
): string[] {
  const seen: string[] = []
  for (const holding of holdings) {
    const key = holding[dimension] === '' ? '미분류' : String(holding[dimension])
    if (!seen.includes(key)) seen.push(key)
  }
  return seen.sort()
}
