/**
 * Parses the 자산운용수익률 workbook — the securities side.
 *
 * Same shape as `assetWorkbook.ts`: no I/O, pinned by unit tests, and checked
 * against arithmetic the spreadsheet already did for itself.
 *
 * Columns are resolved by their header text rather than by fixed index. For the
 * asset workbook there was a verified structure report to hardcode against; here
 * there is only a summary, so reading the header and failing loudly when it does
 * not contain what we need is the honest way round.
 */

import type { CellData, Sheet } from '../google/sheets'
import { parseMonthToken } from '../inspect/patterns'
import type { CurrencyCode, Holding, PortfolioNav, YearMonth } from '../data/model'

/** Header text → the field it feeds, for 기준가(월). */
const NAV_HEADERS = {
  ym: ['일자'],
  cashFlow: ['입출금'],
  marketValue: ['평가금액'],
  nav: ['기준가(좌)', '기준가'],
  benchmark: ['kospi'],
  // Derived, never imported — read only to verify the originals.
  cumulativeIn: ['누적입금'],
  profit: ['수익'],
} as const

/** Header text → field, for 입력정보. */
const HOLDING_HEADERS = {
  owner: ['계좌주'],
  account: ['계좌'],
  name: ['종목'],
  ticker: ['ticker'],
  quantity: ['수량'],
  avgPrice: ['단가'],
  dividendPerShare: ['배당'],
  style: ['구분'],
  region: ['지역'],
  cost: ['수량*매입단가'],
} as const

/**
 * The exchange decides the currency. The region does not: tiger 미국나스닥100 is
 * US-exposed but trades on KRX and settles in won, so reading the region here
 * would misconvert every foreign-exposed domestic ETF.
 */
export function currencyOfExchange(exchange: string): CurrencyCode {
  switch (exchange.trim().toLowerCase()) {
    case 'usd':
      return 'USD'
    case 'jpx':
      return 'JPY'
    default:
      // KRX, kosdaq, and anything unlabelled: this workbook is won by default.
      return 'KRW'
  }
}

function grid(sheet: Sheet): (CellData | undefined)[][] {
  return (sheet.data?.[0]?.rowData ?? []).map((row) => row.values ?? [])
}

function text(rows: (CellData | undefined)[][], r: number, c: number): string {
  return rows[r]?.[c]?.formattedValue?.trim() ?? ''
}

function numberAt(rows: (CellData | undefined)[][], r: number, c: number): number | null {
  const value = rows[r]?.[c]?.effectiveValue?.numberValue
  return typeof value === 'number' ? value : null
}

export class SheetShapeError extends Error {}

/**
 * Finds the header row and maps each wanted field to its column.
 *
 * Scans the first rows for the one that matches the most header names, so a
 * blank or decorative row above the real header does not throw the mapping off.
 */
function resolveColumns(
  rows: (CellData | undefined)[][],
  wanted: Record<string, readonly string[]>,
  searchRows = 8,
): { headerRow: number; columns: Record<string, number | undefined> } {
  const names = Object.entries(wanted)
  let best = { headerRow: -1, hits: 0, columns: {} as Record<string, number | undefined> }

  for (let r = 0; r < Math.min(searchRows, rows.length); r++) {
    const width = rows[r]?.length ?? 0
    const columns: Record<string, number | undefined> = {}
    let hits = 0

    for (const [field, labels] of names) {
      for (let c = 0; c < width; c++) {
        const cell = text(rows, r, c).toLowerCase()
        if (cell === '') continue
        if (labels.some((label) => cell === label.toLowerCase())) {
          if (columns[field] === undefined) {
            columns[field] = c
            hits++
          }
          break
        }
      }
    }

    if (hits > best.hits) best = { headerRow: r, hits, columns }
  }

  return { headerRow: best.headerRow, columns: best.columns }
}

function require_(
  columns: Record<string, number | undefined>,
  field: string,
  sheetName: string,
  label: string,
): number {
  const index = columns[field]
  if (index === undefined) {
    throw new SheetShapeError(`"${sheetName}" 시트에서 "${label}" 열을 찾지 못했습니다.`)
  }
  return index
}

export interface NavMismatch {
  ym: YearMonth
  kind: 'cumulativeIn' | 'profit'
  ours: number
  sheet: number
  diff: number
}

export interface ParsedNavs {
  navs: PortfolioNav[]
  /**
   * Months where our arithmetic disagrees with the sheet's own derived columns.
   * Pure arithmetic, so any mismatch means a column or a month was misread.
   */
  mismatches: NavMismatch[]
  /** Months the sheet carried but which had no usable date. */
  skippedRows: number
  firstYm: YearMonth | null
  lastYm: YearMonth | null
}

/**
 * Reads 기준가(월) — the portfolio seen as a single fund.
 *
 * Only 입출금, 평가금액, 기준가 and kospi are kept. 수익률, 누적입금 and 누적수익
 * all follow from those, so storing them too would be keeping the same fact twice
 * and letting the copies drift apart. They are read here purely to check the
 * originals: `누적입금 = Σ 입출금` and `수익 = Δ평가금액 − 입출금` are arithmetic
 * the sheet already did, so a disagreement means we misread a column or a month.
 */
export function parseNavSheet(sheet: Sheet, sheetName = '기준가(월)'): ParsedNavs {
  const rows = grid(sheet)
  const { headerRow, columns } = resolveColumns(rows, NAV_HEADERS)
  if (headerRow < 0) throw new SheetShapeError(`"${sheetName}" 시트에서 머리글 행을 찾지 못했습니다.`)

  const ymCol = require_(columns, 'ym', sheetName, '일자')
  const cashCol = require_(columns, 'cashFlow', sheetName, '입출금')
  const valueCol = require_(columns, 'marketValue', sheetName, '평가금액')
  const navCol = require_(columns, 'nav', sheetName, '기준가')

  const navs: PortfolioNav[] = []
  const mismatches: NavMismatch[] = []
  let skippedRows = 0

  let runningIn = 0
  let previousValue: number | null = null

  for (let r = headerRow + 1; r < rows.length; r++) {
    const token = parseMonthToken(text(rows, r, ymCol))
    if (!token?.ym) {
      // Only count rows that carry something; trailing blanks are not skips.
      if (numberAt(rows, r, valueCol) !== null) skippedRows++
      continue
    }

    const marketValue = numberAt(rows, r, valueCol)
    const nav = numberAt(rows, r, navCol)
    if (marketValue === null || nav === null) {
      skippedRows++
      continue
    }

    const cashFlow = numberAt(rows, r, cashCol) ?? 0
    const benchmark = columns.benchmark === undefined ? null : numberAt(rows, r, columns.benchmark)

    navs.push({
      ym: token.ym,
      cashFlow,
      marketValue,
      nav,
      ...(benchmark === null ? {} : { benchmark }),
    })

    runningIn += cashFlow
    if (columns.cumulativeIn !== undefined) {
      const sheetValue = numberAt(rows, r, columns.cumulativeIn)
      if (sheetValue !== null && Math.abs(runningIn - sheetValue) > 1) {
        mismatches.push({
          ym: token.ym,
          kind: 'cumulativeIn',
          ours: runningIn,
          sheet: sheetValue,
          diff: runningIn - sheetValue,
        })
      }
    }

    if (columns.profit !== undefined && previousValue !== null) {
      const sheetValue = numberAt(rows, r, columns.profit)
      const ours = marketValue - previousValue - cashFlow
      if (sheetValue !== null && Math.abs(ours - sheetValue) > 1) {
        mismatches.push({ ym: token.ym, kind: 'profit', ours, sheet: sheetValue, diff: ours - sheetValue })
      }
    }
    previousValue = marketValue
  }

  navs.sort((a, b) => a.ym.localeCompare(b.ym))
  mismatches.sort((a, b) => a.ym.localeCompare(b.ym))

  return {
    navs,
    mismatches,
    skippedRows,
    firstYm: navs[0]?.ym ?? null,
    lastYm: navs[navs.length - 1]?.ym ?? null,
  }
}

export interface HoldingMismatch {
  name: string
  ours: number
  sheet: number
  diff: number
}

export interface ParsedHoldings2 {
  holdings: Holding[]
  /** Rows where 수량 × 단가 disagrees with the sheet's own 매입원가 column. */
  mismatches: HoldingMismatch[]
  /** Rows that had no 종목 name and so could not be a position. */
  skippedRows: number
}

/**
 * Reads 입력정보 — the current positions.
 *
 * 평가금액 (L) is skipped: it needs a live price, which is the next phase. What
 * is here is enough for composition at cost.
 */
export function parseHoldingsInput(sheet: Sheet, sheetName = '입력정보'): ParsedHoldings2 {
  const rows = grid(sheet)
  const { headerRow, columns } = resolveColumns(rows, HOLDING_HEADERS)
  if (headerRow < 0) throw new SheetShapeError(`"${sheetName}" 시트에서 머리글 행을 찾지 못했습니다.`)

  const nameCol = require_(columns, 'name', sheetName, '종목')
  const quantityCol = require_(columns, 'quantity', sheetName, '수량')
  const priceCol = require_(columns, 'avgPrice', sheetName, '단가')

  // The exchange column has no header in this workbook, so it is located by
  // position: immediately after 지역. Named columns are resolved by text; this
  // one cannot be, and guessing from the values would be worse.
  const exchangeCol = columns.region === undefined ? undefined : columns.region + 1

  const holdings: Holding[] = []
  const mismatches: HoldingMismatch[] = []
  let skippedRows = 0

  for (let r = headerRow + 1; r < rows.length; r++) {
    const name = text(rows, r, nameCol)
    if (name === '') {
      if (numberAt(rows, r, quantityCol) !== null) skippedRows++
      continue
    }

    const quantity = numberAt(rows, r, quantityCol) ?? 0
    const avgPrice = numberAt(rows, r, priceCol) ?? 0
    const exchange = exchangeCol === undefined ? '' : text(rows, r, exchangeCol)
    const dividend = columns.dividendPerShare === undefined ? null : numberAt(rows, r, columns.dividendPerShare)

    holdings.push({
      id: `h${holdings.length + 1}`,
      owner: columns.owner === undefined ? '' : text(rows, r, columns.owner),
      account: columns.account === undefined ? '' : text(rows, r, columns.account),
      name,
      ticker: columns.ticker === undefined ? '' : text(rows, r, columns.ticker),
      quantity,
      avgPrice,
      ...(dividend === null ? {} : { dividendPerShare: dividend }),
      style: columns.style === undefined ? '' : text(rows, r, columns.style),
      region: columns.region === undefined ? '' : text(rows, r, columns.region),
      exchange,
      currency: currencyOfExchange(exchange),
    })

    if (columns.cost !== undefined) {
      const sheetValue = numberAt(rows, r, columns.cost)
      const ours = quantity * avgPrice
      if (sheetValue !== null && Math.abs(ours - sheetValue) > 1) {
        mismatches.push({ name, ours, sheet: sheetValue, diff: ours - sheetValue })
      }
    }
  }

  return { holdings, mismatches, skippedRows }
}
