/**
 * Turns a ticker as the workbook writes it into a Yahoo Finance symbol.
 *
 * The sheet's tickers come from whichever site the user was scraping, so the
 * spellings disagree: `8001.T` (Yahoo), `BATS: ECH` and `NasdaqGs:hsai` (Google),
 * `ief` lowercased, `O` bare, and six-digit KRX codes. Normalising is a pure
 * function so the rules can be pinned by tests; the proxy looks up whatever
 * symbol it is handed.
 */

import type { CurrencyCode } from '../data/model'

/** Exchange suffixes Yahoo expects, by the workbook's 거래소 value. */
const SUFFIX: Record<string, string> = {
  krx: '.KS',
  kosdaq: '.KQ',
  jpx: '.T',
}

export interface SymbolResult {
  /** What to ask the quote proxy for. */
  symbol: string
  /** Set when the ticker cannot be turned into a symbol, with the reason. */
  problem?: string
}

/**
 * `BATS: ECH` → `ECH`, `NasdaqGs:hsai` → `HSAI`.
 *
 * Google prefixes the venue; Yahoo wants the bare symbol. Taking the part after
 * the last colon handles every observed form.
 */
function stripVenue(ticker: string): string {
  const parts = ticker.split(':')
  return (parts[parts.length - 1] ?? '').trim()
}

export function toYahooSymbol(ticker: string, exchange: string): SymbolResult {
  const bare = stripVenue(ticker).replace(/\s+/g, '')
  if (bare === '') return { symbol: '', problem: '티커가 비어 있습니다.' }

  const venue = exchange.trim().toLowerCase()

  // A ticker that already carries a suffix is a Yahoo symbol; appending a second
  // one would resolve to nothing.
  if (/\.[A-Za-z]{1,3}$/.test(bare)) return { symbol: bare.toUpperCase() }

  const suffix = SUFFIX[venue]
  if (suffix) return { symbol: `${bare}${suffix}` }

  // USD, or an unlabelled venue: US symbols carry no suffix, which matches the
  // importer's default of treating an unlabelled exchange as won-market US-free.
  if (venue === 'usd' || venue === '') return { symbol: bare.toUpperCase() }

  return {
    symbol: bare.toUpperCase(),
    problem: `거래소 "${exchange}" 를 알지 못해 접미사를 붙이지 못했습니다.`,
  }
}

/** The FX pairs a set of holdings needs, excluding won. */
export function fxPairsFor(currencies: readonly CurrencyCode[]): string[] {
  const needed = new Set<string>()
  for (const currency of currencies) {
    if (currency !== 'KRW') needed.add(`${currency}KRW`)
  }
  return [...needed].sort()
}
