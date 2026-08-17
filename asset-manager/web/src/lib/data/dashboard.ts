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

type Side = 'ASSET' | 'DEBT' | 'EXCLUDED'

/**
 * Which side of the balance sheet each item counts on, resolved once instead of
 * per snapshot.
 *
 * Three-way rather than a boolean on purpose. Written as "debt, otherwise
 * asset", an item that belongs in neither would silently be counted as an asset
 * — which is how the 마통 double count stayed invisible.
 */
function sideByItem(data: AssetData): ReadonlyMap<string, Side> {
  const kindOf = new Map(data.categories.map((category) => [category.id, category.kind]))
  return new Map(
    data.items.map((item) => [
      item.id,
      item.countedElsewhere ? 'EXCLUDED' : kindOf.get(item.categoryId) === 'DEBT' ? 'DEBT' : 'ASSET',
    ]),
  )
}

/**
 * Monthly asset, debt and net totals, ascending. Only months that hold at least
 * one record appear — an absent month means "not entered", which is not zero.
 */
export function monthlyTotals(data: AssetData): MonthTotals[] {
  const sides = sideByItem(data)
  const byYm = new Map<YearMonth, { asset: number; debt: number }>()

  for (const snapshot of data.snapshots) {
    const side = sides.get(snapshot.itemId)
    if (side === undefined) continue
    // The month still counts as recorded, so a month holding only excluded items
    // does not vanish from the series.
    const entry = byYm.get(snapshot.ym) ?? { asset: 0, debt: 0 }
    byYm.set(snapshot.ym, entry)
    if (side === 'EXCLUDED') continue

    const value = displayAmount(snapshot.amount, side === 'DEBT')
    if (side === 'DEBT') entry.debt += value
    else entry.asset += value
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
  /**
   * Items left out of every total because another item already contains them.
   * Surfaced so the totals never quietly disagree with the rows.
   */
  excluded: { itemId: string; name: string; amount: number; reason: string }[]
}

function kindOf(data: AssetData, categoryId: string): Category['kind'] | undefined {
  return data.categories.find((category) => category.id === categoryId)?.kind
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
  const sides = sideByItem(data)
  const itemById = new Map(data.items.map((item) => [item.id, item]))
  const byCategory = new Map<string, number>()
  const excluded: MonthSummary['excluded'] = []

  let asset = 0
  let debt = 0
  let found = false

  for (const snapshot of data.snapshots) {
    if (snapshot.ym !== ym) continue
    const item = itemById.get(snapshot.itemId)
    const side = sides.get(snapshot.itemId)
    if (!item || side === undefined) continue

    found = true

    if (side === 'EXCLUDED') {
      // Kept out of byCategory as well: a composition segment must be part of
      // the total the bar is a breakdown of.
      excluded.push({
        itemId: item.id,
        name: item.name,
        amount: displayAmount(snapshot.amount, kindOf(data, item.categoryId) === 'DEBT'),
        reason: item.countedElsewhere!,
      })
      continue
    }

    const value = displayAmount(snapshot.amount, side === 'DEBT')
    if (side === 'DEBT') debt += value
    else asset += value
    byCategory.set(item.categoryId, (byCategory.get(item.categoryId) ?? 0) + value)
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
    excluded,
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
