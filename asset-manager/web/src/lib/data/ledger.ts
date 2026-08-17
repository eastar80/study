/**
 * Turns the stored data into the rows the ledger grid draws.
 *
 * The sign convention lives here and nowhere else: debts are stored negative so
 * sums need no branching, and this module flips them to positive for display.
 * If that conversion leaked into the UI, some screens would show debts negative
 * and others positive, and nothing would look obviously wrong.
 */

import type { AssetData, Category, Item, Snapshot, YearMonth } from './model'

export function monthsOfYear(year: number): YearMonth[] {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`)
}

export function yearOf(ym: YearMonth): number {
  return Number(ym.slice(0, 4))
}

/** Years that hold at least one record, ascending. */
export function availableYears(snapshots: Snapshot[]): number[] {
  const years = new Set<number>()
  for (const snapshot of snapshots) years.add(yearOf(snapshot.ym))
  return [...years].sort((a, b) => a - b)
}

export type SnapshotIndex = Map<string, Snapshot>

function key(itemId: string, ym: YearMonth): string {
  return `${itemId}|${ym}`
}

/**
 * Index for cell lookup. With ~11,600 records a linear scan per cell would be
 * 8 million comparisons to draw one year.
 */
export function indexSnapshots(snapshots: Snapshot[]): SnapshotIndex {
  const index: SnapshotIndex = new Map()
  for (const snapshot of snapshots) index.set(key(snapshot.itemId, snapshot.ym), snapshot)
  return index
}

export interface Cell {
  ym: YearMonth
  /** Display value: positive for both assets and debts. Null means no record. */
  value: number | null
  memo: string | null
  /** Annual interest rate, loans only. */
  rate: number | null
}

export type RowKind = 'group' | 'item' | 'subtotal' | 'assetTotal' | 'debtTotal' | 'netWorth'

export interface LedgerRow {
  kind: RowKind
  /** Stable key for React. */
  id: string
  label: string
  cells: Cell[]
  /** Present on item rows so the UI can edit and hide them. */
  item?: Item
  /** Present on group and item rows. */
  category?: Category
  /** Change from the first to the last month that has a value, in display sign. */
  yearChange: number | null
}

export interface BuildOptions {
  showHidden?: boolean
  /** Category ids whose items are folded away. */
  collapsed?: ReadonlySet<string>
}

function sumCells(rows: LedgerRow[], months: YearMonth[]): Cell[] {
  return months.map((ym, index) => {
    let total = 0
    let any = false
    for (const row of rows) {
      const value = row.cells[index]?.value
      if (value !== null && value !== undefined) {
        total += value
        any = true
      }
    }
    // A month where nothing was recorded stays blank rather than showing 0 —
    // "no data" and "zero balance" are different facts.
    return { ym, value: any ? total : null, memo: null, rate: null }
  })
}

function changeOverYear(cells: Cell[]): number | null {
  const values = cells.filter((cell) => cell.value !== null)
  if (values.length < 2) return null
  return values[values.length - 1]!.value! - values[0]!.value!
}

/**
 * Builds the row list for one year: each category as a group with its items and
 * a subtotal, then the asset total, the debt total, and net worth.
 */
export function buildLedger(data: AssetData, year: number, options: BuildOptions = {}): LedgerRow[] {
  const months = monthsOfYear(year)
  const index = indexSnapshots(data.snapshots)
  const collapsed = options.collapsed ?? new Set<string>()

  const categories = [...data.categories].sort((a, b) => a.order - b.order)
  const rows: LedgerRow[] = []
  const assetItemRows: LedgerRow[] = []
  const debtItemRows: LedgerRow[] = []

  for (const category of categories) {
    const isDebt = category.kind === 'DEBT'
    const items = data.items
      .filter((item) => item.categoryId === category.id)
      .filter((item) => options.showHidden || !item.hidden)
      .sort((a, b) => a.order - b.order)

    if (items.length === 0) continue

    const itemRows: LedgerRow[] = items.map((item) => {
      const cells: Cell[] = months.map((ym) => {
        const snapshot = index.get(key(item.id, ym))
        if (!snapshot) return { ym, value: null, memo: null, rate: null }
        return {
          ym,
          // Debts are stored negative; show them positive.
          value: isDebt ? Math.abs(snapshot.amount) : snapshot.amount,
          memo: snapshot.memo ?? null,
          rate: snapshot.rate ?? null,
        }
      })

      return {
        kind: 'item',
        id: item.id,
        label: item.name,
        cells,
        item,
        category,
        yearChange: changeOverYear(cells),
      }
    })

    if (isDebt) debtItemRows.push(...itemRows)
    else assetItemRows.push(...itemRows)

    const subtotalCells = sumCells(itemRows, months)
    rows.push({
      kind: 'group',
      id: `g-${category.id}`,
      label: category.name,
      cells: subtotalCells,
      category,
      yearChange: changeOverYear(subtotalCells),
    })

    if (!collapsed.has(category.id)) {
      rows.push(...itemRows)
      rows.push({
        kind: 'subtotal',
        id: `s-${category.id}`,
        label: `${category.name} 소계`,
        cells: subtotalCells,
        category,
        yearChange: changeOverYear(subtotalCells),
      })
    }
  }

  const assetCells = sumCells(assetItemRows, months)
  const debtCells = sumCells(debtItemRows, months)

  // Net worth is computed from the stored signs, where debts are negative, so it
  // is a plain sum. Recomputing from the display values would need a subtraction
  // and a chance to get the direction wrong.
  const netCells: Cell[] = months.map((ym, i) => {
    const asset = assetCells[i]?.value
    const debt = debtCells[i]?.value
    if (asset === null && debt === null) return { ym, value: null, memo: null, rate: null }
    return { ym, value: (asset ?? 0) - (debt ?? 0), memo: null, rate: null }
  })

  if (assetItemRows.length > 0) {
    rows.push({
      kind: 'assetTotal',
      id: 'total-asset',
      label: '자산 합계',
      cells: assetCells,
      yearChange: changeOverYear(assetCells),
    })
  }
  if (debtItemRows.length > 0) {
    rows.push({
      kind: 'debtTotal',
      id: 'total-debt',
      label: '부채 합계',
      cells: debtCells,
      yearChange: changeOverYear(debtCells),
    })
  }
  if (assetItemRows.length > 0 || debtItemRows.length > 0) {
    rows.push({
      kind: 'netWorth',
      id: 'total-net',
      label: '순자산',
      cells: netCells,
      yearChange: changeOverYear(netCells),
    })
  }

  return rows
}

/**
 * Applies a cell edit, returning the next snapshot list.
 *
 * `value` arrives in display sign; the stored sign is restored here so the
 * convention stays in one place. A blank value removes the record rather than
 * storing zero.
 */
export function setCell(
  snapshots: Snapshot[],
  item: Item,
  isDebt: boolean,
  ym: YearMonth,
  value: number | null,
  memo: string | null,
): Snapshot[] {
  const rest = snapshots.filter((snapshot) => !(snapshot.itemId === item.id && snapshot.ym === ym))
  if (value === null) return rest

  const stored = isDebt ? -Math.abs(value) : value
  return [...rest, { itemId: item.id, ym, amount: stored, ...(memo ? { memo } : {}) }]
}
