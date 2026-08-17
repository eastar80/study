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

export interface AssetData {
  version: 1
  settings: Settings
  categories: Category[]
  items: Item[]
  snapshots: Snapshot[]
  fxRates: FxRate[]
  notes: MonthlyNote[]
  goals: Goal[]
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
  }
}
