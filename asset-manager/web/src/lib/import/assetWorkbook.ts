/**
 * Parses the 자산현황 workbook into the app's data model.
 *
 * This is the riskiest code in the project: a misread month header or category
 * row would put sixteen years of balances quietly in the wrong place. So it is
 * kept free of I/O, pinned by unit tests, and — crucially — checked against
 * totals the spreadsheet computed itself (see `crossCheck`).
 *
 * Sheet shapes this expects, from the structure report:
 *
 *   잔액입력      row 1 기관 / 2 계좌번호 / 3 상세 / 4 대분류 / 5 중분류, rows 6+ monthly
 *                 balances with the date in column A. Months run down the page.
 *   자산보유현황  B~H category totals (derived), I~K asset/net/delta (derived),
 *                 L~S debt input, T~W totals (derived), X event note.
 */

import type { CellData, Sheet } from '../google/sheets'
import { columnLetter } from '../google/sheets'
import { parseMonthToken } from '../inspect/patterns'
import type { Category, Item, MonthlyNote, Snapshot, YearMonth } from '../data/model'

/**
 * Row indices (0-based) of the header rows in 잔액입력.
 * Row 1 holds account numbers and is deliberately not imported — the app has no
 * use for them and they are the most sensitive thing in the workbook.
 */
const ROW_INSTITUTION = 0
const ROW_DETAIL = 2
const ROW_CATEGORY = 3
const ROW_SUBCATEGORY = 4
const ROW_FIRST_DATA = 5

/** Column indices (0-based) in 자산보유현황. */
const HOLDINGS_ASSET_TOTALS = { start: 1, end: 8 } // B~H, category totals
const HOLDINGS_DEBT = { start: 11, end: 19 } // L~S, debt input
const HOLDINGS_DEBT_TOTAL = 19 // T
const HOLDINGS_NOTE = 23 // X

/**
 * Categories that are debts despite living in the asset sheet. 마통 is an
 * overdraft line: money owed, recorded there with a negative sign.
 */
const DEBT_CATEGORIES = new Set(['마통'])

const CATEGORY_COLORS = [
  'emerald',
  'sky',
  'violet',
  'amber',
  'rose',
  'teal',
  'indigo',
  'orange',
  'lime',
  'fuchsia',
]

export interface DroppedRow {
  ym: YearMonth
  /** The date label of the row that was not used. */
  date: string
  reason: string
}

export interface RenamedItem {
  original: string
  assigned: string
  sourceKey: string
}

/** Totals the spreadsheet computed itself, used only to verify the import. */
export interface ExpectedTotals {
  /** categoryName -> ym -> amount */
  byCategory: Map<string, Map<YearMonth, number>>
  /** ym -> total debt, as a positive number the way the sheet writes it. */
  debt: Map<YearMonth, number>
}

export interface ParsedBalances {
  categories: Category[]
  items: Item[]
  snapshots: Snapshot[]
  droppedRows: DroppedRow[]
  renamedItems: RenamedItem[]
  /** Column letters whose 대분류 cell was empty, so they could not be placed. */
  unclassifiedColumns: string[]
  /** Our own per-category monthly sums, to compare against the sheet's totals. */
  ownTotals: Map<string, Map<YearMonth, number>>
  firstYm: YearMonth | null
  lastYm: YearMonth | null
}

function grid(sheet: Sheet): (CellData | undefined)[][] {
  const rowData = sheet.data?.[0]?.rowData ?? []
  return rowData.map((row) => row.values ?? [])
}

function text(rows: (CellData | undefined)[][], r: number, c: number): string {
  return rows[r]?.[c]?.formattedValue?.trim() ?? ''
}

function numberAt(rows: (CellData | undefined)[][], r: number, c: number): number | null {
  const cell = rows[r]?.[c]
  if (!cell) return null
  const value = cell.effectiveValue?.numberValue
  if (typeof value !== 'number') return null
  // A formatted-but-empty cell renders as "-" in this accounting format; the
  // effectiveValue is absent for those, so reaching here means a real number.
  return value
}

function noteAt(rows: (CellData | undefined)[][], r: number, c: number): string | null {
  const note = rows[r]?.[c]?.note?.trim()
  return note ? note : null
}

/** The year-month of a data row, from its date cell in column A. */
function rowYm(rows: (CellData | undefined)[][], r: number): { ym: YearMonth; label: string } | null {
  const label = text(rows, r, 0)
  const token = parseMonthToken(label)
  return token?.ym ? { ym: token.ym, label } : null
}

interface ColumnDef {
  index: number
  sourceKey: string
  institution: string
  detail: string
  category: string
  subCategory: string
}

function readColumnDefs(rows: (CellData | undefined)[][]): ColumnDef[] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const defs: ColumnDef[] = []

  // Column A holds dates, so items start at B.
  for (let c = 1; c < width; c++) {
    const institution = text(rows, ROW_INSTITUTION, c)
    const detail = text(rows, ROW_DETAIL, c)
    const category = text(rows, ROW_CATEGORY, c)
    const subCategory = text(rows, ROW_SUBCATEGORY, c)

    if (!institution && !detail && !category) continue

    defs.push({
      index: c,
      sourceKey: columnLetter(c),
      institution,
      detail,
      category,
      subCategory,
    })
  }

  return defs
}

/** 기관 + 상세, per the naming decision; account numbers stay out of the app. */
function baseName(def: ColumnDef): string {
  const parts = [def.institution, def.detail].filter((part) => part !== '')
  return parts.length > 0 ? parts.join(' ') : def.sourceKey
}

export function parseBalanceSheet(sheet: Sheet): ParsedBalances {
  const rows = grid(sheet)
  const defs = readColumnDefs(rows)

  const categories: Category[] = []
  const categoryIdByName = new Map<string, string>()
  const unclassifiedColumns: string[] = []

  for (const def of defs) {
    if (!def.category) {
      unclassifiedColumns.push(def.sourceKey)
      continue
    }
    if (categoryIdByName.has(def.category)) continue

    const id = `c${categories.length + 1}`
    categoryIdByName.set(def.category, id)
    categories.push({
      id,
      kind: DEBT_CATEGORIES.has(def.category) ? 'DEBT' : 'ASSET',
      name: def.category,
      color: CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length]!,
      order: categories.length + 1,
    })
  }

  const items: Item[] = []
  const renamedItems: RenamedItem[] = []
  const usedNames = new Map<string, number>()
  const itemIdByColumn = new Map<number, string>()

  for (const def of defs) {
    const categoryId = categoryIdByName.get(def.category)
    if (!categoryId) continue

    // Institution names repeat across columns (국민은행 appears five times), so a
    // collision is expected rather than exceptional.
    const base = baseName(def)
    const seen = usedNames.get(base) ?? 0
    usedNames.set(base, seen + 1)
    const name = seen === 0 ? base : `${base} ${seen + 1}`
    if (seen > 0) renamedItems.push({ original: base, assigned: name, sourceKey: def.sourceKey })

    const id = `i${items.length + 1}`
    itemIdByColumn.set(def.index, id)
    items.push({
      id,
      categoryId,
      name,
      currency: 'KRW',
      hidden: false,
      order: items.length + 1,
      ...(def.subCategory ? { subCategory: def.subCategory } : {}),
      sourceKey: def.sourceKey,
    })
  }

  // Later rows win when a month repeats, so remember which row fed each month
  // and report the row that lost.
  const rowByYm = new Map<YearMonth, { row: number; label: string }>()
  const droppedRows: DroppedRow[] = []

  for (let r = ROW_FIRST_DATA; r < rows.length; r++) {
    const found = rowYm(rows, r)
    if (!found) continue

    const previous = rowByYm.get(found.ym)
    if (previous) {
      droppedRows.push({
        ym: found.ym,
        date: previous.label,
        reason: `같은 달에 ${previous.label}, ${found.label} 두 행이 있어 나중 행을 사용했습니다.`,
      })
    }
    rowByYm.set(found.ym, { row: r, label: found.label })
  }

  const snapshots: Snapshot[] = []
  const byCategory = new Map<string, Map<YearMonth, number>>()

  for (const [ym, { row }] of rowByYm) {
    for (const def of defs) {
      const itemId = itemIdByColumn.get(def.index)
      if (!itemId) continue

      const amount = numberAt(rows, row, def.index)
      if (amount === null) continue

      const memo = noteAt(rows, row, def.index)
      snapshots.push({ itemId, ym, amount, ...(memo ? { memo } : {}) })

      // Accumulate our own per-category totals for the cross-check.
      let months = byCategory.get(def.category)
      if (!months) {
        months = new Map()
        byCategory.set(def.category, months)
      }
      months.set(ym, (months.get(ym) ?? 0) + amount)
    }
  }

  const sortedYms = [...rowByYm.keys()].sort()

  return {
    categories,
    items,
    snapshots,
    droppedRows,
    renamedItems,
    unclassifiedColumns,
    ownTotals: byCategory,
    firstYm: sortedYms[0] ?? null,
    lastYm: sortedYms[sortedYms.length - 1] ?? null,
  }
}

export interface ParsedHoldings {
  /** Debt items from L~S. */
  items: Omit<Item, 'id' | 'categoryId' | 'order'>[]
  /** Snapshots keyed by the item's sourceKey, since ids are assigned by the caller. */
  snapshotsBySourceKey: Map<string, { ym: YearMonth; amount: number; memo?: string }[]>
  notes: MonthlyNote[]
  expectedTotals: ExpectedTotals
}

export function parseHoldingsSheet(sheet: Sheet): ParsedHoldings {
  const rows = grid(sheet)

  const debtNames = new Map<number, string>()
  for (let c = HOLDINGS_DEBT.start; c < HOLDINGS_DEBT.end; c++) {
    const name = text(rows, 0, c)
    if (name) debtNames.set(c, name)
  }

  const assetTotalNames = new Map<number, string>()
  for (let c = HOLDINGS_ASSET_TOTALS.start; c < HOLDINGS_ASSET_TOTALS.end; c++) {
    const name = text(rows, 0, c)
    if (name) assetTotalNames.set(c, name)
  }

  const snapshotsBySourceKey = new Map<string, { ym: YearMonth; amount: number; memo?: string }[]>()
  const notes: MonthlyNote[] = []
  const byCategory = new Map<string, Map<YearMonth, number>>()
  const debtTotals = new Map<YearMonth, number>()

  for (let r = 1; r < rows.length; r++) {
    const found = rowYm(rows, r)
    if (!found) continue
    const { ym } = found

    for (const c of debtNames.keys()) {
      const amount = numberAt(rows, r, c)
      if (amount === null) continue

      const key = columnLetter(c)
      const list = snapshotsBySourceKey.get(key) ?? []
      const memo = noteAt(rows, r, c)
      // The sheet writes debts as positive; the model stores them negative so
      // sums and composition need no branching.
      list.push({ ym, amount: -Math.abs(amount), ...(memo ? { memo } : {}) })
      snapshotsBySourceKey.set(key, list)
    }

    for (const [c, name] of assetTotalNames) {
      const amount = numberAt(rows, r, c)
      if (amount === null) continue
      let months = byCategory.get(name)
      if (!months) {
        months = new Map()
        byCategory.set(name, months)
      }
      months.set(ym, amount)
    }

    const debtTotal = numberAt(rows, r, HOLDINGS_DEBT_TOTAL)
    if (debtTotal !== null) debtTotals.set(ym, debtTotal)

    const note = text(rows, r, HOLDINGS_NOTE)
    if (note) notes.push({ module: 'ASSET', ym, status: 'DONE', body: note })
  }

  const items = [...debtNames.entries()].map(([c, name]) => ({
    name,
    currency: 'KRW' as const,
    hidden: false,
    isLoan: true,
    sourceKey: columnLetter(c),
  }))

  return {
    items,
    snapshotsBySourceKey,
    notes,
    expectedTotals: { byCategory, debt: debtTotals },
  }
}

export interface Mismatch {
  category: string
  ym: YearMonth
  ours: number
  sheet: number
  diff: number
}

/**
 * Compares our per-category sums against the totals the spreadsheet computed.
 *
 * The category names in 자산보유현황 do not always match the 대분류 spelling in
 * 잔액입력 (`ficc` vs `FICC`), so matching is case-insensitive.
 */
export function crossCheck(
  ours: Map<string, Map<YearMonth, number>>,
  expected: ExpectedTotals,
  tolerance = 1,
): { mismatches: Mismatch[]; comparedCategories: string[]; unmatchedSheetCategories: string[] } {
  const normalise = (name: string) => name.trim().toLowerCase()
  const oursByKey = new Map([...ours.entries()].map(([name, months]) => [normalise(name), months]))

  const mismatches: Mismatch[] = []
  const comparedCategories: string[] = []
  const unmatchedSheetCategories: string[] = []

  for (const [sheetName, sheetMonths] of expected.byCategory) {
    const ourMonths = oursByKey.get(normalise(sheetName))
    if (!ourMonths) {
      unmatchedSheetCategories.push(sheetName)
      continue
    }
    comparedCategories.push(sheetName)

    for (const [ym, sheetValue] of sheetMonths) {
      const ourValue = ourMonths.get(ym) ?? 0
      const diff = ourValue - sheetValue
      if (Math.abs(diff) > tolerance) {
        mismatches.push({ category: sheetName, ym, ours: ourValue, sheet: sheetValue, diff })
      }
    }
  }

  mismatches.sort((a, b) => (a.ym === b.ym ? a.category.localeCompare(b.category) : a.ym.localeCompare(b.ym)))
  return { mismatches, comparedCategories, unmatchedSheetCategories }
}

/**
 * Merges the two sheets into one dataset, assigning ids to the debt items from
 * 자산보유현황 and folding their snapshots in.
 */
export function combine(
  balances: ParsedBalances,
  holdings: ParsedHoldings,
): { categories: Category[]; items: Item[]; snapshots: Snapshot[]; notes: MonthlyNote[] } {
  const categories = [...balances.categories]
  const items = [...balances.items]
  const snapshots = [...balances.snapshots]

  if (holdings.items.length > 0) {
    // Debts from 자산보유현황 form their own category; 마통 already came across
    // from the asset sheet as a separate one.
    const debtCategory: Category = {
      id: `c${categories.length + 1}`,
      kind: 'DEBT',
      name: '부채',
      color: 'rose',
      order: categories.length + 1,
    }
    categories.push(debtCategory)

    for (const partial of holdings.items) {
      const id = `i${items.length + 1}`
      items.push({ ...partial, id, categoryId: debtCategory.id, order: items.length + 1 })

      for (const entry of holdings.snapshotsBySourceKey.get(partial.sourceKey!) ?? []) {
        snapshots.push({ itemId: id, ym: entry.ym, amount: entry.amount, ...(entry.memo ? { memo: entry.memo } : {}) })
      }
    }
  }

  return { categories, items, snapshots, notes: holdings.notes }
}
