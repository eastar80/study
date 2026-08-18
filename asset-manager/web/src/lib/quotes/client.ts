/**
 * Reads quotes and FX from the Apps Script relay (docs/07-시세-프록시.md).
 *
 * The proxy's contract that matters here: **`fx[pair].rate` is 원 per ONE unit.**
 * Korean quotes are often 원/100엔, which differs by exactly 100× — this project
 * has already been wrong that way once. The unit is settled in the proxy and this
 * module passes it through untouched.
 */

import { getQuoteProxyUrl } from '../../config'
import type { CurrencyCode } from '../data/model'

export interface Quote {
  symbol: string
  /** In the instrument's own currency, as the exchange lists it. */
  price: number
  previousClose?: number
  /** What the exchange trades in, per the quote source. */
  currency?: string
  name?: string
}

export interface QuoteSet {
  asOf: string
  quotes: Map<string, Quote>
  /** currency → 원 per one unit. KRW is always 1. */
  rates: Map<CurrencyCode, number>
  /** Symbols the proxy could not price, with its reason. */
  failed: Map<string, string>
}

interface RawResponse {
  ok?: boolean
  error?: string
  asOf?: string
  quotes?: Record<string, { price?: number; previousClose?: number; currency?: string; name?: string; error?: string }>
  fx?: Record<string, { rate?: number; unit?: string; error?: string }>
}

/**
 * Fetches the given symbols and FX pairs.
 *
 * A symbol that fails lands in `failed` rather than throwing: one bad ticker
 * among forty should not leave the screen blank, and naming it is what lets the
 * user fix the ticker.
 */
export async function fetchQuotes(
  symbols: readonly string[],
  pairs: readonly string[],
): Promise<QuoteSet> {
  const base = getQuoteProxyUrl()
  if (base === '') throw new Error('시세 프록시 주소가 없습니다. 환경 설정에서 입력하세요.')
  if (symbols.length === 0 && pairs.length === 0) {
    return { asOf: new Date().toISOString(), quotes: new Map(), rates: new Map([['KRW', 1]]), failed: new Map() }
  }

  const url = new URL(base)
  if (symbols.length > 0) url.searchParams.set('symbols', [...new Set(symbols)].join(','))
  if (pairs.length > 0) url.searchParams.set('fx', [...new Set(pairs)].join(','))

  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error(`시세 프록시가 ${response.status} 를 반환했습니다.`)
  }

  const text = await response.text()
  let raw: RawResponse
  try {
    raw = JSON.parse(text) as RawResponse
  } catch {
    // A signed-in-only deployment returns the Google login page, which is HTML.
    throw new Error(
      'JSON이 아닌 응답이 왔습니다. 웹 앱 배포의 "액세스 권한이 있는 사용자" 가 "모든 사용자" 인지, 주소가 /exec 로 끝나는지 확인하세요.',
    )
  }

  if (raw.ok === false) throw new Error(raw.error ?? '시세 프록시가 실패를 반환했습니다.')

  const quotes = new Map<string, Quote>()
  const failed = new Map<string, string>()

  for (const [symbol, entry] of Object.entries(raw.quotes ?? {})) {
    if (entry?.error) {
      failed.set(symbol, entry.error)
      continue
    }
    if (typeof entry?.price !== 'number') {
      failed.set(symbol, '가격이 없습니다.')
      continue
    }
    quotes.set(symbol, {
      symbol,
      price: entry.price,
      ...(typeof entry.previousClose === 'number' ? { previousClose: entry.previousClose } : {}),
      ...(entry.currency ? { currency: entry.currency } : {}),
      ...(entry.name ? { name: entry.name } : {}),
    })
  }

  // Won is not a pair the proxy is asked for; it is 1 by definition.
  const rates = new Map<CurrencyCode, number>([['KRW', 1]])
  for (const [pair, entry] of Object.entries(raw.fx ?? {})) {
    if (entry?.error) {
      failed.set(pair, entry.error)
      continue
    }
    if (typeof entry?.rate !== 'number') {
      failed.set(pair, '환율이 없습니다.')
      continue
    }
    // `USDKRW` → USD. The proxy already normalised the unit to one.
    const currency = pair.slice(0, 3).toUpperCase() as CurrencyCode
    rates.set(currency, entry.rate)
  }

  return { asOf: raw.asOf ?? new Date().toISOString(), quotes, rates, failed }
}
