/**
 * Aggregates the securities workbook into what the portfolio screen shows.
 *
 * Like `dashboard.ts`, this stores nothing of its own — every figure is derived
 * from `portfolioNavs` and `holdings`, so it cannot drift from what was imported.
 *
 * Nothing here needs a live price. Current valuation and return per holding wait
 * for the quote relay; what the workbook already knows is the whole-portfolio
 * performance history and the composition at cost.
 */

import type { CurrencyCode, Holding, PortfolioNav } from './model'

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

/** Purchase cost of a position, in its own currency. */
export function costOf(holding: Holding): number {
  return holding.quantity * holding.avgPrice
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
  cost: number
  /** Fraction of this currency's total, 0–1. */
  share: number
}

export interface CurrencyGroup {
  currency: CurrencyCode
  total: number
  slices: CostSlice[]
}

const CURRENCY_ORDER: CurrencyCode[] = ['KRW', 'USD', 'JPY', 'EUR', 'GBP', 'CNY']

/**
 * Composition at cost, grouped by currency.
 *
 * Costs are in each holding's own currency and there is no exchange rate yet, so
 * they are never added across currencies — an invented rate would be a made-up
 * number sitting in the middle of a chart. One bar per currency says the same
 * thing truthfully, and collapses to a single ordinary bar when everything is won.
 */
export function compositionByCurrency(
  holdings: readonly Holding[],
  dimension: 'style' | 'region',
): CurrencyGroup[] {
  const byCurrency = new Map<CurrencyCode, Map<string, number>>()

  for (const holding of holdings) {
    const cost = costOf(holding)
    if (cost === 0) continue

    const slices = byCurrency.get(holding.currency) ?? new Map<string, number>()
    const key = holding[dimension] === '' ? '미분류' : holding[dimension]
    slices.set(key, (slices.get(key) ?? 0) + cost)
    byCurrency.set(holding.currency, slices)
  }

  return [...byCurrency.entries()]
    .map(([currency, slices]) => {
      const total = [...slices.values()].reduce((sum, cost) => sum + cost, 0)
      return {
        currency,
        total,
        slices: [...slices.entries()]
          .map(([key, cost]) => ({ key, cost, share: total === 0 ? 0 : cost / total }))
          .sort((a, b) => b.cost - a.cost),
      }
    })
    .sort((a, b) => {
      const order = CURRENCY_ORDER.indexOf(a.currency) - CURRENCY_ORDER.indexOf(b.currency)
      return order !== 0 ? order : b.total - a.total
    })
}

/** Distinct values of a dimension across all holdings, for stable colour slots. */
export function dimensionKeys(
  holdings: readonly Holding[],
  dimension: 'style' | 'region',
): string[] {
  const seen: string[] = []
  for (const holding of holdings) {
    const key = holding[dimension] === '' ? '미분류' : holding[dimension]
    if (!seen.includes(key)) seen.push(key)
  }
  return seen.sort()
}
