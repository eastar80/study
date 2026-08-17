/**
 * The shape of `/Asset Manager/data.json`.
 *
 * Two conventions carry through the whole app:
 *  - Debts are stored NEGATIVE. Sums and composition need no branching; screens
 *    flip the sign when displaying.
 *  - `amount` is in the item's OWN currency, never converted. Conversion happens
 *    at read time using the pinned month-end rate, so a past month's net worth
 *    does not move when today's exchange rate does.
 */

export type CurrencyCode = 'KRW' | 'USD' | 'JPY' | 'EUR' | 'GBP' | 'CNY'

export type CategoryKind = 'ASSET' | 'DEBT'

/** 'YYYY-MM' — string keys keep sorting and grouping to string operations. */
export type YearMonth = string

export interface Settings {
  baseCurrency: CurrencyCode
  maskAmounts: boolean
  comparisonBasis: 'MoM' | 'YoY'
}

export interface Category {
  id: string
  kind: CategoryKind
  name: string
  color: string
  order: number
}

export interface Item {
  id: string
  categoryId: string
  name: string
  currency: CurrencyCode
  hidden: boolean
  order: number
  /**
   * Middle tier of the source classification (중분류), between the category and
   * the item — e.g. 현금성자산 > 수시입출 > 국민은행 보통예금. Kept so groupings
   * finer than the category stay possible; the ledger grid still groups by
   * category.
   */
  subCategory?: string
  /**
   * Column letter in the source spreadsheet ('B', 'AI'). Lets a re-import
   * recognise the same item after it has been renamed here.
   */
  sourceKey?: string
  /** Loans carry an interest rate on each monthly snapshot. */
  isLoan?: boolean
  /**
   * Set when this balance is already included in another item, and why.
   *
   * A value here means the item is never added to a total again — not to assets,
   * not to debts, not to net worth, not to a composition bar. It still appears in
   * the ledger, because the monthly detail is worth keeping.
   *
   * 마통 is the case that forced this: it is entered in 잔액입력 for the monthly
   * detail, but 자산보유현황's 은행부채 column already contains it, so counting
   * both meant counting it twice.
   *
   * The reason is a string rather than a boolean so it cannot be set without
   * saying why, and so screens can show the explanation. A total that silently
   * disagrees with the rows above it is worse than the double count.
   */
  countedElsewhere?: string
}

export interface Snapshot {
  itemId: string
  ym: YearMonth
  /** In the item's own currency. Negative for debts. */
  amount: number
  /** Annual interest rate in percent, loans only. */
  rate?: number
  memo?: string | null
}

export interface FxRate {
  ym: YearMonth
  /** KRW per one unit of the foreign currency, at month end. */
  rates: Partial<Record<CurrencyCode, number>>
}

export interface MonthlyNote {
  module: 'ASSET' | 'PORTFOLIO'
  ym: YearMonth
  status: 'DRAFT' | 'DONE'
  body: string
}

export interface Goal {
  scope: 'NET_WORTH' | 'MONTH_RETURN' | 'YEAR_RETURN'
  period: string
  target: number
}

/**
 * A correction applied to the source workbook during import.
 *
 * Some values in the spreadsheet are known to be wrong — a bond left at face
 * value after it became worthless, for instance — and the sheet's own aggregate
 * columns already exclude them. Rather than hardcoding such a number in the
 * importer (it is data, not logic) or editing hundreds of cells by hand, the
 * correction is stored as a rule and reapplied on every import.
 *
 * Items are addressed by `sourceKey`, the source column letter, because item ids
 * are reassigned on each import while the column stays put.
 */
export interface ImportAdjustment {
  sourceKey: string
  sheet: 'BALANCE' | 'HOLDINGS'
  /** Inclusive. Omit for "from the beginning". */
  fromYm?: YearMonth
  /** Inclusive. Omit for "until the end". */
  toYm?: YearMonth
  /** Added to the stored amount. Negative to reduce an overstated balance. */
  delta: number
  reason: string
}

export interface AssetData {
  version: 1
  settings: Settings
  categories: Category[]
  items: Item[]
  snapshots: Snapshot[]
  fxRates: FxRate[]
  notes: MonthlyNote[]
  goals: Goal[]
  /** Corrections reapplied on every import. See ImportAdjustment. */
  importAdjustments: ImportAdjustment[]
}

export function emptyData(): AssetData {
  return {
    version: 1,
    settings: { baseCurrency: 'KRW', maskAmounts: false, comparisonBasis: 'MoM' },
    categories: [],
    items: [],
    snapshots: [],
    fxRates: [],
    notes: [],
    goals: [],
    importAdjustments: [],
  }
}

/**
 * Validates and fills in a parsed data file. Anything unrecognised is dropped
 * rather than trusted — a corrupt file should not crash the grid.
 */
export function normaliseData(raw: unknown): AssetData {
  const base = emptyData()
  if (typeof raw !== 'object' || raw === null) return base

  const input = raw as Partial<AssetData>
  return {
    version: 1,
    settings: { ...base.settings, ...(input.settings ?? {}) },
    categories: Array.isArray(input.categories) ? input.categories : [],
    items: Array.isArray(input.items) ? input.items : [],
    snapshots: Array.isArray(input.snapshots) ? input.snapshots : [],
    fxRates: Array.isArray(input.fxRates) ? input.fxRates : [],
    notes: Array.isArray(input.notes) ? input.notes : [],
    goals: Array.isArray(input.goals) ? input.goals : [],
    importAdjustments: Array.isArray(input.importAdjustments) ? input.importAdjustments : [],
  }
}
