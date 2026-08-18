/**
 * Turning a quote into a won figure.
 *
 * The rule, from the user: **the share price shows in its own currency, the
 * market value shows in won.**
 *
 *   평가금액(원) = 수량 × 주가(해당 통화) × 환율(원/1단위)
 *
 * Cost basis is already won — the workbook's 매입원가 column (see
 * docs/06 §4.3), so a return is a won-to-won comparison and needs no rate.
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
  /** Won. Cost comes from the sheet and is already won. */
  costKrw: number
  gainKrw: number | null
  returnPct: number | null
  /** Why there is no value, when there is none. */
  problem?: string
}

/**
 * A position with no quotable ticker — cash, a fund with no listing.
 *
 * Valued at the won figure the sheet recorded, because cash has no market price
 * to look up. `quantity × rate` looked tempting: the yen cash line stores the yen
 * amount as its quantity with the rate in 단가, so it would come out right. But
 * the won cash line stores quantity 1 with the amount in 단가, and there
 * `quantity × rate` is 1원. The recorded cost is right in both shapes.
 *
 * The cost was struck at whatever rate the sheet used, so a foreign cash line
 * does not re-value as the rate moves. Refining that needs the historical rate,
 * which the workbook does not carry.
 */
function isCashLike(holding: Holding): boolean {
  return holding.ticker.trim() === '' || /^cash$/i.test(holding.ticker.trim())
}

export function valueHolding(
  holding: Holding,
  price: number | null,
  rate: number | null,
  costKrw: number,
): Valued {
  let marketValueKrw: number | null = null
  let problem: string | undefined

  if (isCashLike(holding)) {
    // No price to fetch and no rate needed: the sheet's won figure stands.
    marketValueKrw = costKrw
  } else if (price === null) {
    problem = '시세를 받지 못했습니다.'
  } else if (rate === null) {
    problem = `${holding.currency} 환율이 없습니다.`
  } else {
    marketValueKrw = holding.quantity * price * rate
  }

  // Left null rather than falling back to cost: showing the cost would read as a
  // 0% return, which is a different claim from "unknown".
  const gainKrw = marketValueKrw === null ? null : marketValueKrw - costKrw
  const returnPct =
    marketValueKrw === null || costKrw === 0 ? null : ((marketValueKrw - costKrw) / Math.abs(costKrw)) * 100

  return {
    holding,
    price: isCashLike(holding) ? null : price,
    rate,
    marketValueKrw,
    costKrw,
    gainKrw,
    returnPct,
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

export function summariseValues(rows: readonly Valued[]): PortfolioValue {
  const valued = rows.filter((row) => row.marketValueKrw !== null)
  const marketValueKrw = valued.reduce((sum, row) => sum + row.marketValueKrw!, 0)
  const costKrw = valued.reduce((sum, row) => sum + row.costKrw, 0)

  return {
    rows: [...rows],
    marketValueKrw,
    costKrw,
    gainKrw: marketValueKrw - costKrw,
    returnPct: costKrw === 0 ? null : ((marketValueKrw - costKrw) / Math.abs(costKrw)) * 100,
    unvalued: rows.filter((row) => row.marketValueKrw === null),
  }
}
