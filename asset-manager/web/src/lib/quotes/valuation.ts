/**
 * Turning a quote into a won figure.
 *
 * The rule, from the user: **the share price shows in its own currency, the
 * market value shows in won.**
 *
 *   평가금액(원) = 수량 × 주가(해당 통화) × 환율(원/1단위)
 *   매입원가(원) = 매입원가(해당 통화) × 환율(원/1단위)
 *
 * Both sides of the return need the rate, because the workbook's 매입원가 column is
 * in the holding's own currency too (see docs/06 §4.3). Treating it as won is a
 * mistake this file made for a while, and it understated every foreign cost by the
 * exchange rate.
 */

import type { CurrencyCode, Holding } from '../data/model'

/**
 * 원 per ONE unit of `currency`.
 *
 * The parameter this feeds is named `krwPerUnit` everywhere on purpose. A yen
 * rate written as 원/100엔 is exactly 100× the right number, and that mistake has
 * already cost this project one round of wrong figures. Where the type cannot
 * enforce the unit, the name does.
 */
export function krwPerUnit(
  currency: CurrencyCode,
  rates: ReadonlyMap<CurrencyCode, number>,
): number | null {
  if (currency === 'KRW') return 1
  return rates.get(currency) ?? null
}

export interface Valued {
  holding: Holding
  /** In the holding's own currency. Null when no quote was available. */
  price: number | null
  /** 원 per one unit of the holding's currency. */
  rate: number | null
  /** Won. Null when the price or the rate is missing. */
  marketValueKrw: number | null
  /** Won — the sheet's own-currency cost at `rate`. Null without a rate. */
  costKrw: number | null
  gainKrw: number | null
  returnPct: number | null
  /** Set when the price was typed in rather than fetched. */
  manualPrice?: boolean
  /** Why there is no value, when there is none. */
  problem?: string
}

/**
 * A position with no quotable ticker — cash, in any currency.
 *
 * Its price is **one unit of its own currency**: 1원, 1달러, 1엔. So it goes
 * through the same `수량 × 현재가 × 환율` as everything else, and its 수량 is the
 * amount held. The 단가 cell on a cash row holds an exchange rate rather than a
 * price, so it is never read.
 *
 * A foreign cash line therefore re-values as the rate moves, which is what cash
 * actually does.
 */
export function isCashLike(holding: Holding): boolean {
  const ticker = holding.ticker.trim()
  return ticker === '' || /^cash$/i.test(ticker)
}

/**
 * @param price In the holding's own currency. Ignored for cash, which is 1.
 * @param rate 원 per ONE unit. Null when the pair was not fetched.
 * @param costKrw The holding's own-currency cost already converted; see
 *   `costKrwOf`. Null when the rate is missing.
 * @param options.quoteCurrency What the quote source says the price is in. Given,
 *   it is checked against the holding's currency; see below.
 */
export function valueHolding(
  holding: Holding,
  price: number | null,
  rate: number | null,
  costKrw: number | null,
  options: { manualPrice?: boolean; quoteCurrency?: string } = {},
): Valued {
  // Cash is priced at one unit of its own currency, not looked up.
  const effectivePrice = isCashLike(holding) ? 1 : price

  /*
   * The quote's own currency is a cross-check, and it catches a case the sheet
   * cannot: `dgro` and `schd` are US listings held through a domestic broker, so
   * the workbook's 거래소 column says KRX and the importer reads them as won. The
   * price that comes back is dollars. Multiplying by a rate of 1 gave ₩68 and a
   * −99.9% return — a wrong number that looks like a number.
   *
   * Converting at the quote's currency instead would be guessing which unit the
   * 매입원가 column used for those rows, and this project has already guessed a
   * currency wrong twice. So the disagreement is reported and the value withheld.
   */
  const quoteCurrency = options.quoteCurrency?.toUpperCase()
  const currencyMismatch =
    !isCashLike(holding) &&
    options.manualPrice !== true &&
    quoteCurrency !== undefined &&
    quoteCurrency !== '' &&
    quoteCurrency !== holding.currency

  let marketValueKrw: number | null = null
  let problem: string | undefined

  if (currencyMismatch) {
    problem = `시세는 ${quoteCurrency}, 시트의 통화는 ${holding.currency} 입니다. 거래소 칸을 확인하세요.`
  } else if (effectivePrice === null) {
    problem = '시세를 받지 못했습니다.'
  } else if (rate === null) {
    problem = `${holding.currency} 환율이 없습니다.`
  } else {
    marketValueKrw = holding.quantity * effectivePrice * rate
  }

  // Left null rather than falling back to cost: showing the cost would read as a
  // 0% return, which is a different claim from "unknown".
  const gainKrw = marketValueKrw === null || costKrw === null ? null : marketValueKrw - costKrw
  const returnPct =
    gainKrw === null || costKrw === null || costKrw === 0 ? null : (gainKrw / Math.abs(costKrw)) * 100

  return {
    holding,
    // Withheld on a mismatch: the number is real but not in this row's currency,
    // and the column is labelled with that currency.
    price: currencyMismatch ? null : effectivePrice,
    rate,
    marketValueKrw,
    costKrw,
    gainKrw,
    returnPct,
    ...(options.manualPrice ? { manualPrice: true } : {}),
    ...(problem ? { problem } : {}),
  }
}

export interface PortfolioValue {
  rows: Valued[]
  /** Won, over the rows that could be valued. */
  marketValueKrw: number
  costKrw: number
  gainKrw: number
  returnPct: number | null
  /** Rows with no value, so a total is never quietly short. */
  unvalued: Valued[]
}

/**
 * Totals over the rows that have both a value and a cost.
 *
 * Only those rows, on both sides: a cost counted against a market value that
 * could not be computed would show as a total loss. What is left out is in
 * `unvalued`, so the shortfall is visible rather than absorbed.
 */
export function summariseValues(rows: readonly Valued[]): PortfolioValue {
  const valued = rows.filter((row) => row.marketValueKrw !== null && row.costKrw !== null)
  const marketValueKrw = valued.reduce((sum, row) => sum + row.marketValueKrw!, 0)
  const costKrw = valued.reduce((sum, row) => sum + row.costKrw!, 0)

  return {
    rows: [...rows],
    marketValueKrw,
    costKrw,
    gainKrw: marketValueKrw - costKrw,
    returnPct: costKrw === 0 ? null : ((marketValueKrw - costKrw) / Math.abs(costKrw)) * 100,
    unvalued: rows.filter((row) => row.marketValueKrw === null),
  }
}
