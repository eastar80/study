import { describe, expect, it } from 'vitest'
import { krwPerUnit, summariseValues, valueHolding } from './valuation'
import type { CurrencyCode, Holding } from '../data/model'

function holding(partial: Partial<Holding> = {}): Holding {
  return {
    id: 'h1',
    owner: '호빵',
    account: '미래해외',
    name: '미쓰비시상사',
    ticker: '8058.T',
    quantity: 400,
    avgPrice: 2_534_000,
    costKrw: 10_136_000,
    priceScale: 0.01,
    style: '배당',
    region: '일본',
    exchange: 'JPX',
    currency: 'JPY',
    ...partial,
  }
}

const RATES = new Map<CurrencyCode, number>([
  ['KRW', 1],
  ['USD', 1385],
  ['JPY', 9],
])

describe('krwPerUnit', () => {
  it('is 1 for won, by definition', () => {
    expect(krwPerUnit('KRW', new Map())).toBe(1)
  })

  it('reads the rate for a foreign currency', () => {
    expect(krwPerUnit('JPY', RATES)).toBe(9)
  })

  it('is null when the rate is missing, rather than defaulting to 1', () => {
    // Defaulting to 1 would value a yen position at 1/9 of its worth and look
    // like a plausible number.
    expect(krwPerUnit('EUR', RATES)).toBeNull()
  })
})

describe('valueHolding', () => {
  it('values a yen position in won: 수량 × 주가(엔) × 환율', () => {
    // The user's formula, exactly: 400 × ¥2,780 × 9 = 10,008,000원.
    const valued = valueHolding(holding(), 2_780, 9, 10_136_000)
    expect(valued.marketValueKrw).toBe(10_008_000)
    expect(valued.price).toBe(2_780)
    expect(valued.rate).toBe(9)
  })

  it('values a dollar position the same way', () => {
    const tesla = holding({
      name: 'Tesla',
      ticker: 'TSLA',
      quantity: 55,
      currency: 'USD',
      exchange: 'USD',
      priceScale: 1,
    })
    expect(valueHolding(tesla, 296.8, 1385, 16_324_000).marketValueKrw).toBeCloseTo(22_608_740)
  })

  it('would be 100x wrong on a 원/100엔 rate — which is why the unit is settled once', () => {
    // Kept as a test rather than a comment: this is the mistake the project
    // already made, and the proxy normalising to 원/1엔 is what prevents it.
    const perYen = valueHolding(holding(), 2_780, 9, 10_136_000).marketValueKrw!
    const perHundredYen = valueHolding(holding(), 2_780, 900, 10_136_000).marketValueKrw!
    expect(perHundredYen / perYen).toBe(100)
  })

  it('needs no rate for a won holding', () => {
    const kodex = holding({
      name: 'kodex 200',
      ticker: '069500',
      quantity: 420,
      currency: 'KRW',
      exchange: 'KRX',
    })
    expect(valueHolding(kodex, 38_500, 1, 13_482_000).marketValueKrw).toBe(16_170_000)
  })

  it('values a cash line at the won figure the sheet recorded', () => {
    // Yen cash: quantity is the yen amount, rate sits in 단가. Observed 78만원.
    const cash = holding({ name: '현금', ticker: 'cash', quantity: 86_667, costKrw: 780_003 })
    const valued = valueHolding(cash, null, 9, 780_003)
    expect(valued.marketValueKrw).toBe(780_003)
    expect(valued.problem).toBeUndefined()
  })

  it('values won cash correctly, where quantity is not a currency amount', () => {
    // This is why cash is not `quantity × rate`: a won cash line stores quantity
    // 1 with the amount in 단가, so that formula would say 1원.
    const cash = holding({
      name: '현금성 MMF',
      ticker: 'cash',
      quantity: 1,
      avgPrice: 32_400_000,
      costKrw: 32_400_000,
      currency: 'KRW',
      exchange: 'KRX',
      priceScale: 1,
    })
    expect(valueHolding(cash, null, 1, 32_400_000).marketValueKrw).toBe(32_400_000)
  })

  it('treats an empty ticker as cash too', () => {
    const cash = holding({ ticker: '   ', quantity: 1000, costKrw: 9000 })
    expect(valueHolding(cash, null, 9, 9000).marketValueKrw).toBe(9000)
  })

  it('shows no price for cash, because there is none to quote', () => {
    const cash = holding({ ticker: 'cash', costKrw: 780_003 })
    expect(valueHolding(cash, null, 9, 780_003).price).toBeNull()
  })

  it('leaves the value null and says why when the quote is missing', () => {
    // Falling back to cost would read as a 0% return, which is a different claim
    // from "unknown".
    const valued = valueHolding(holding(), null, 9, 10_136_000)
    expect(valued.marketValueKrw).toBeNull()
    expect(valued.gainKrw).toBeNull()
    expect(valued.returnPct).toBeNull()
    expect(valued.problem).toContain('시세')
  })

  it('names the missing currency when the rate is absent', () => {
    const valued = valueHolding(holding(), 2_780, null, 10_136_000)
    expect(valued.marketValueKrw).toBeNull()
    expect(valued.problem).toContain('JPY')
  })

  it('computes gain and return against the won cost', () => {
    const valued = valueHolding(holding(), 2_780, 9, 10_000_000)
    expect(valued.gainKrw).toBe(8_000)
    expect(valued.returnPct).toBeCloseTo(0.08)
  })

  it('leaves the return null when there is no cost to compare against', () => {
    expect(valueHolding(holding(), 2_780, 9, 0).returnPct).toBeNull()
  })
})

describe('summariseValues', () => {
  it('totals only what could be valued, and lists the rest', () => {
    const rows = [
      valueHolding(holding({ id: 'h1' }), 2_780, 9, 10_000_000),
      valueHolding(holding({ id: 'h2' }), null, 9, 5_000_000),
    ]
    const summary = summariseValues(rows)

    expect(summary.marketValueKrw).toBe(10_008_000)
    // The unvalued row's cost is left out too, so the return is not skewed by a
    // cost with no matching value.
    expect(summary.costKrw).toBe(10_000_000)
    expect(summary.unvalued.map((row) => row.holding.id)).toEqual(['h2'])
  })

  it('reports the portfolio return over the valued rows', () => {
    const summary = summariseValues([valueHolding(holding(), 2_780, 9, 10_000_000)])
    expect(summary.gainKrw).toBe(8_000)
    expect(summary.returnPct).toBeCloseTo(0.08)
  })

  it('has no return when nothing could be valued', () => {
    const summary = summariseValues([valueHolding(holding(), null, null, 10_000_000)])
    expect(summary.marketValueKrw).toBe(0)
    expect(summary.returnPct).toBeNull()
    expect(summary.unvalued).toHaveLength(1)
  })
})
