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

/**
 * One month of the portfolio treated as a single fund.
 *
 * From `기준가(월)`, which is a performance ledger for the whole portfolio rather
 * than per holding. Only the three originals are stored — 수익률, 누적입금 and
 * 누적수익 are all derivable from these, so keeping them would be storing the
 * same fact twice and inviting the copies to disagree.
 */
export interface PortfolioNav {
  ym: YearMonth
  /** Net cash in or out that month. Negative is a withdrawal. */
  cashFlow: number
  /** Month-end valuation. */
  marketValue: number
  /** Unit price, fund style — starts at 1000 and moves only with performance. */
  nav: number
  /** KOSPI close, the benchmark the workbook already carries. */
  benchmark?: number
}

/** 배당 · 성장 · 가치 · 모멘텀 · 현금 — how the user actually classifies holdings. */
export type HoldingStyle = string

/**
 * One position, from `입력정보`. A current snapshot, not a time series.
 *
 * Money fields here are in the **holding's own currency**, not won — the
 * workbook's 매입원가 column is a dollar amount for a dollar holding and a yen
 * amount for a yen one. Converting to won happens at read time with the rate of
 * the day, so `평가금액` and `매입원가(원)` are both derived, never stored.
 */
export interface Holding {
  id: string
  /** 계좌주. Aggregated by default; splitting by owner is an option. */
  owner: string
  /** 계좌 — 유안타주식, 미래ISA, … */
  account: string
  name: string
  /** As written in the sheet; spellings differ by quote source. */
  ticker: string
  quantity: number
  /**
   * The 단가 column verbatim, which is **not** the price per share: a yen holding
   * carries 100×. Multiply by `priceScale` to get the real per-share price.
   */
  avgPrice: number
  /**
   * The sheet's 매입원가 column, **in this holding's own currency.**
   *
   * The authoritative cost. Deriving it from 수량 × 단가 is what made yen holdings
   * 100× too large. Absent when the sheet left the cell blank.
   */
  costNative?: number
  /**
   * Was `costNative` under a wrong name. Read for data written before the rename —
   * the number was always the native amount, only the label was wrong.
   *
   * @deprecated
   */
  costKrw?: number
  /**
   * 매입원가 ÷ (수량 × 단가) — the factor that turns 단가 back into a per-share
   * price **in the holding's own currency.** 0.01 for yen, 1 for everything else
   * observed.
   *
   * Read out of the sheet rather than hardcoded per currency, so a currency added
   * later is handled by the data instead of by a new branch.
   */
  priceScale?: number
  /** Per share, in the same units as avgPrice. */
  dividendPerShare?: number
  /** 구분 — the axis this user manages by. */
  style: HoldingStyle
  /** 지역 — exposure, not settlement. */
  region: string
  /** 거래소 — KRX · kosdaq · USD · JPX. */
  exchange: string
  /**
   * The market this trades on. It decides **which quote and which FX rate to
   * fetch**, and it is also the unit of the money fields above.
   */
  currency: CurrencyCode
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
  /** Monthly portfolio performance, from the securities workbook. */
  portfolioNavs: PortfolioNav[]
  /** Current positions, from the securities workbook. */
  holdings: Holding[]
  /** Hand-entered prices for holdings no quote source carries. */
  priceOverrides: PriceOverride[]
}

/**
 * A price the user typed in, for a holding no quote source covers — an unlisted
 * company, a domestic public fund.
 *
 * Kept in the data like `ImportAdjustment`, so it survives a re-import, shows on
 * screen, and can be removed. Addressed by 종목명 because an unlisted holding has
 * no stable ticker, and the name is what the user sees.
 *
 * It beats a fetched quote. A hand-entered value silently overwritten by an
 * automatic one gives no way to tell why it did not take.
 */
export interface PriceOverride {
  /** 종목명, matched exactly. */
  name: string
  /** Per share, in the holding's own currency. */
  price: number
  note?: string
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
    portfolioNavs: [],
    holdings: [],
    priceOverrides: [],
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
    portfolioNavs: Array.isArray(input.portfolioNavs) ? input.portfolioNavs : [],
    holdings: Array.isArray(input.holdings) ? input.holdings : [],
    priceOverrides: Array.isArray(input.priceOverrides) ? input.priceOverrides : [],
  }
}
