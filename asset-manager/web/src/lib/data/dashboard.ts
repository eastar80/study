/**
 * Aggregates the ledger into the numbers the dashboard shows.
 *
 * Everything here is derived from `snapshots` — the dashboard stores nothing of
 * its own, so it cannot drift from the ledger. The sign convention comes from
 * `displayAmount` for the same reason.
 */

import { displayAmount } from './ledger'
import type { AssetData, Category, YearMonth } from './model'

export interface MonthTotals {
  ym: YearMonth
  asset: number
  /** Debt in display sign: positive is owed. Can go negative — see 마통. */
  debt: number
  net: number
}

/** Which items are debts, resolved once instead of per snapshot. */
function debtItemIds(data: AssetData): ReadonlySet<string> {
  const debtCategories = new Set(
    data.categories.filter((category) => category.kind === 'DEBT').map((category) => category.id),
  )
  return new Set(
    data.items.filter((item) => debtCategories.has(item.categoryId)).map((item) => item.id),
  )
}

/**
 * Monthly asset, debt and net totals, ascending. Only months that hold at least
 * one record appear — an absent month means "not entered", which is not zero.
 */
export function monthlyTotals(data: AssetData): MonthTotals[] {
  const debts = debtItemIds(data)
  const byYm = new Map<YearMonth, { asset: number; debt: number }>()

  for (const snapshot of data.snapshots) {
    const isDebt = debts.has(snapshot.itemId)
    const entry = byYm.get(snapshot.ym) ?? { asset: 0, debt: 0 }
    const value = displayAmount(snapshot.amount, isDebt)
    if (isDebt) entry.debt += value
    else entry.asset += value
    byYm.set(snapshot.ym, entry)
  }

  return [...byYm.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, { asset, debt }]) => ({ ym, asset, debt, net: asset - debt }))
}

export interface CategorySlice {
  categoryId: string
  name: string
  /** Display sign. Debt slices are positive when owed. */
  amount: number
  /** Fraction of the bar this slice occupies, 0–1. */
  share: number
}

export interface MonthSummary {
  ym: YearMonth
  asset: number
  debt: number
  net: number
  /** 총부채 / 총자산 as a percentage. Null when there are no assets to divide by. */
  leverage: number | null
  /** Asset categories with a positive total, largest first. */
  assets: CategorySlice[]
  /** Debt categories that are money owed, largest first. */
  debts: CategorySlice[]
  /**
   * Debt categories holding money instead of owing it — a 마통 in credit. These
   * are an offset against the debt total, not a component of it, so they cannot
   * be a segment of the composition bar.
   */
  debtOffsets: CategorySlice[]
}

function slices(
  totals: Map<string, number>,
  categories: Category[],
  keep: (amount: number) => boolean,
): CategorySlice[] {
  const kept = categories
    .filter((category) => totals.has(category.id) && keep(totals.get(category.id)!))
    .map((category) => ({ category, amount: totals.get(category.id)! }))

  // Shares are over the segments actually drawn, so a bar always fills.
  const sum = kept.reduce((running, { amount }) => running + Math.abs(amount), 0)

  return kept
    .map(({ category, amount }) => ({
      categoryId: category.id,
      name: category.name,
      amount,
      share: sum === 0 ? 0 : Math.abs(amount) / sum,
    }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
}

/** Everything one month's cards need. Null when that month holds no records. */
export function summariseMonth(data: AssetData, ym: YearMonth): MonthSummary | null {
  const debts = debtItemIds(data)
  const categoryOf = new Map(data.items.map((item) => [item.id, item.categoryId]))
  const byCategory = new Map<string, number>()

  let asset = 0
  let debt = 0
  let found = false

  for (const snapshot of data.snapshots) {
    if (snapshot.ym !== ym) continue
    const categoryId = categoryOf.get(snapshot.itemId)
    if (!categoryId) continue

    found = true
    const isDebt = debts.has(snapshot.itemId)
    const value = displayAmount(snapshot.amount, isDebt)
    if (isDebt) debt += value
    else asset += value
    byCategory.set(categoryId, (byCategory.get(categoryId) ?? 0) + value)
  }

  if (!found) return null

  const assetCategories = data.categories.filter((category) => category.kind === 'ASSET')
  const debtCategories = data.categories.filter((category) => category.kind === 'DEBT')

  return {
    ym,
    asset,
    debt,
    net: asset - debt,
    leverage: asset === 0 ? null : (debt / asset) * 100,
    assets: slices(byCategory, assetCategories, (amount) => amount > 0),
    debts: slices(byCategory, debtCategories, (amount) => amount > 0),
    debtOffsets: slices(byCategory, debtCategories, (amount) => amount < 0),
  }
}

export interface Change {
  /** The month compared against — named, rather than assumed to be ym − 1. */
  fromYm: YearMonth
  delta: number
  /** Percent change. Null when the earlier value was zero. */
  percent: number | null
}

/**
 * Change against the previous month that holds records, which is not always the
 * previous calendar month. Naming the month it compared against keeps the label
 * honest when there is a gap.
 */
export function changeAgainstPrevious(
  totals: readonly MonthTotals[],
  ym: YearMonth,
  pick: (month: MonthTotals) => number,
): Change | null {
  const index = totals.findIndex((month) => month.ym === ym)
  if (index <= 0) return null

  const previous = totals[index - 1]!
  const before = pick(previous)
  const now = pick(totals[index]!)
  return {
    fromYm: previous.ym,
    delta: now - before,
    percent: before === 0 ? null : ((now - before) / Math.abs(before)) * 100,
  }
}

/** The window of up to `count` months ending at `ym`, for the trend chart. */
export function trailingMonths(
  totals: readonly MonthTotals[],
  ym: YearMonth,
  count: number,
): MonthTotals[] {
  const index = totals.findIndex((month) => month.ym === ym)
  if (index < 0) return []
  return totals.slice(Math.max(0, index + 1 - count), index + 1)
}
