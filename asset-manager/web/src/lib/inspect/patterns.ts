/**
 * Pure pattern recognisers used by the sheet inspector.
 *
 * These carry the risk in the whole import path: if a month header or a currency
 * is misread, every number downstream lands in the wrong place. They are kept
 * free of I/O so they can be pinned by unit tests.
 */

import type { CellData, CellFormat } from '../google/sheets'

export interface MonthToken {
  /** 'YYYY-MM' when a year could be determined. */
  ym: string | null
  /** 1-12 when the text names a month but no year. */
  month: number | null
}

/** Two-digit years: 00-70 read as 2000s, 71-99 as 1900s. */
function expandYear(raw: string): number {
  const n = Number(raw)
  if (raw.length <= 2) return n <= 70 ? 2000 + n : 1900 + n
  return n
}

function ym(year: number, month: number): MonthToken | null {
  if (month < 1 || month > 12) return null
  if (year < 1900 || year > 2200) return null
  return { ym: `${year}-${String(month).padStart(2, '0')}`, month }
}

/**
 * Recognises the month-header spellings that show up in hand-made Korean asset
 * sheets. Returns null for anything else.
 */
export function parseMonthToken(raw: string | null | undefined): MonthToken | null {
  if (raw == null) return null

  // Leading apostrophes ('26/07) are a spreadsheet text-literal marker.
  // Whitespace around separators is common in hand-typed headers (2026. 07).
  const text = String(raw)
    .trim()
    .replace(/^'+/, '')
    .replace(/\s*([-/.년월])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

  if (text === '') return null

  // 2026년 7월 / 2026년07월 / 26년7월
  let m = /^(\d{2,4})년(\d{1,2})월?$/.exec(text)
  if (m) return ym(expandYear(m[1]!), Number(m[2]!))

  // 2026-07-01 / 2026.07.01 / 2026/07/31 — a full date collapses to its month
  m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\.?$/.exec(text)
  if (m) return ym(Number(m[1]!), Number(m[2]!))

  // 07/2026 — month first, recognised by the four-digit second group
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(text)
  if (m) return ym(Number(m[2]!), Number(m[1]!))

  // 2026-07 / 2026/7 / 2026.07 / 26-07 / 26/7
  m = /^(\d{2,4})[-/.](\d{1,2})\.?$/.exec(text)
  if (m) return ym(expandYear(m[1]!), Number(m[2]!))

  // 202607
  m = /^(\d{4})(\d{2})$/.exec(text)
  if (m) {
    const candidate = ym(Number(m[1]!), Number(m[2]!))
    if (candidate) return candidate
  }

  // 7월 / 07월 — month with no year
  m = /^(\d{1,2})월$/.exec(text)
  if (m) {
    const month = Number(m[1]!)
    if (month >= 1 && month <= 12) return { ym: null, month }
  }

  return null
}

export type CellKind = 'currency' | 'percent' | 'date' | 'number' | 'text' | 'empty'

export interface CellClass {
  kind: CellKind
  /** ISO code when a currency symbol or code was recognised. */
  currency?: string
}

const CURRENCY_SIGNS: [RegExp, string][] = [
  [/₩|KRW|원/, 'KRW'],
  [/\$|USD/, 'USD'],
  [/¥|JPY|엔/, 'JPY'],
  [/€|EUR/, 'EUR'],
  [/£|GBP/, 'GBP'],
  [/元|CNY|RMB/, 'CNY'],
]

function currencyFromPattern(pattern: string | undefined): string | undefined {
  if (!pattern) return undefined
  for (const [re, code] of CURRENCY_SIGNS) {
    if (re.test(pattern)) return code
  }
  return undefined
}

/**
 * Classifies a cell from its effective number format, falling back to the
 * rendered text when a sheet carries no explicit format.
 */
export function classifyCell(cell: CellData | undefined): CellClass {
  const text = cell?.formattedValue?.trim() ?? ''
  const value = cell?.effectiveValue
  const format: CellFormat | undefined = cell?.effectiveFormat

  if (text === '' && value?.numberValue === undefined && value?.stringValue === undefined) {
    return { kind: 'empty' }
  }

  const numberFormat = format?.numberFormat
  switch (numberFormat?.type) {
    case 'CURRENCY': {
      const currency = currencyFromPattern(numberFormat.pattern) ?? currencyFromPattern(text)
      return currency ? { kind: 'currency', currency } : { kind: 'currency' }
    }
    case 'PERCENT':
      return { kind: 'percent' }
    case 'DATE':
    case 'DATE_TIME':
      return { kind: 'date' }
    case 'NUMBER':
    case 'SCIENTIFIC': {
      // A "number" format can still spell out a currency in its pattern.
      const currency = currencyFromPattern(numberFormat.pattern)
      return currency ? { kind: 'currency', currency } : { kind: 'number' }
    }
    default:
      break
  }

  // No usable format: read the rendered text.
  if (typeof value?.numberValue === 'number') {
    if (text.endsWith('%')) return { kind: 'percent' }
    const currency = currencyFromPattern(text)
    if (currency) return { kind: 'currency', currency }
    if (parseMonthToken(text)) return { kind: 'date' }
    return { kind: 'number' }
  }

  if (text.endsWith('%') && /[\d.]/.test(text)) return { kind: 'percent' }
  const currency = currencyFromPattern(text)
  if (currency && /\d/.test(text)) return { kind: 'currency', currency }

  return { kind: 'text' }
}

export type TickerKind = 'krx' | 'foreign'

/**
 * KRX codes are six digits; foreign tickers are 1-5 upper-case letters,
 * optionally with a class suffix (BRK.B).
 */
export function detectTicker(raw: string | null | undefined): TickerKind | null {
  if (raw == null) return null
  const text = String(raw).trim().replace(/^'+/, '')
  if (/^\d{6}$/.test(text)) return 'krx'
  if (/^[A-Z]{1,5}(\.[A-Z])?$/.test(text)) return 'foreign'
  return null
}

/** Leading whitespace, which hand-made sheets use to express hierarchy. */
export function leadingIndent(raw: string | null | undefined): number {
  if (raw == null) return 0
  const match = /^[\s ]*/.exec(String(raw))
  return match ? match[0].length : 0
}

/** Stable key for a background colour so distinct group colours can be counted. */
export function backgroundKey(format: CellFormat | undefined): string | null {
  const bg = format?.backgroundColor
  if (!bg) return null
  const to255 = (v: number | undefined) => Math.round((v ?? 0) * 255)
  const key = `${to255(bg.red)},${to255(bg.green)},${to255(bg.blue)}`
  // White and unset are the same thing for grouping purposes.
  return key === '255,255,255' || key === '0,0,0' ? null : key
}

const NUMERIC_KINDS: ReadonlySet<CellKind> = new Set<CellKind>(['currency', 'percent', 'number'])

export function isNumericKind(kind: CellKind): boolean {
  return NUMERIC_KINDS.has(kind)
}

/** Integer digit count, used to tell an interest rate from a balance. */
export function integerDigits(value: number): number {
  const abs = Math.abs(Math.trunc(value))
  return abs === 0 ? 1 : String(abs).length
}
