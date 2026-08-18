import { describe, expect, it } from 'vitest'
import { isCashLike, krwPerUnit, summariseValues, valueHolding } from './valuation'
import type { CurrencyCode, Holding } from '../data/model'

function holding(partial: Partial<Holding> = {}): Holding {
  return {
    id: 'h1',
    owner: '호빵',
    account: '미래해외',
    name: '미쓰비시상사',
    ticker: '8058.T',
    quantity: 400,
    avgPrice: 253_400,
    costNative: 1_013_600,
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

  it('prices cash at one unit of its own currency, ignoring any quote', () => {
    // 86,667엔 × 1엔 × 9원 = 780,003원, which is the figure the sheet shows.
    // The `null` price is what the proxy returns for an unquotable ticker; cash
    // does not consult it.
    const cash = holding({ name: '현금(¥)', ticker: 'cash', quantity: 86_667 })
    const valued = valueHolding(cash, null, 9, 780_003)
    expect(valued.price).toBe(1)
    expect(valued.marketValueKrw).toBe(780_003)
    expect(valued.problem).toBeUndefined()
  })

  it('prices won cash at 1원, so 수량 is the amount', () => {
    const cash = holding({
      name: '현금(₩)',
      ticker: 'cash',
      quantity: 32_400_000,
      currency: 'KRW',
      exchange: 'KRX',
      priceScale: 1,
    })
    expect(valueHolding(cash, null, 1, 32_400_000).marketValueKrw).toBe(32_400_000)
  })

  it('prices dollar cash at 1달러', () => {
    const cash = holding({
      name: '현금($)',
      ticker: 'cash',
      quantity: 1_200,
      currency: 'USD',
      exchange: 'USD',
      priceScale: 1,
    })
    expect(valueHolding(cash, null, 1385, 1_662_000).marketValueKrw).toBe(1_662_000)
  })

  it('never reads 단가 for cash, so a rate sitting in that column cannot leak in', () => {
    // The observed 현금(¥) row carries 단가 9 — an exchange rate, not a price. A
    // quote of 9 would be 9× the truth if it were ever consulted.
    const cash = holding({ ticker: 'cash', quantity: 86_667, avgPrice: 9 })
    expect(valueHolding(cash, 9, 9, 780_003).marketValueKrw).toBe(780_003)
  })

  it('treats an empty ticker as cash too', () => {
    const cash = holding({ ticker: '   ', quantity: 1000 })
    expect(valueHolding(cash, null, 9, 9000).marketValueKrw).toBe(9000)
  })

  it('says which rate is missing even for cash, rather than valuing it at zero', () => {
    const cash = holding({ ticker: 'cash', quantity: 86_667 })
    const valued = valueHolding(cash, null, null, null)
    expect(valued.marketValueKrw).toBeNull()
    expect(valued.problem).toContain('JPY')
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

  it('leaves gain and return null when the cost could not be converted', () => {
    // Cost is null exactly when the rate is, so this row has no value either —
    // but a gain computed against a missing cost would read as pure profit.
    const valued = valueHolding(holding(), 2_780, null, null)
    expect(valued.costKrw).toBeNull()
    expect(valued.gainKrw).toBeNull()
    expect(valued.returnPct).toBeNull()
  })

  it('withholds the value when the quote\'s currency contradicts the sheet', () => {
    // The observed case: `dgro` is a US listing whose 거래소 cell says KRX, so the
    // importer read it as won. The quote comes back in dollars, and a rate of 1
    // turned $68 into ₩68 — a −99.9% return that looks like a number.
    const dgro = holding({
      name: 'dgro',
      ticker: 'dgro',
      quantity: 80,
      avgPrice: 62_400,
      currency: 'KRW',
      exchange: 'KRX',
      priceScale: 1,
    })
    const valued = valueHolding(dgro, 68.4, 1, 4_992_000, { quoteCurrency: 'USD' })
    expect(valued.marketValueKrw).toBeNull()
    expect(valued.price).toBeNull()
    expect(valued.problem).toContain('USD')
    expect(valued.problem).toContain('KRW')
  })

  it('values normally when the quote agrees with the sheet', () => {
    const kodex = holding({ name: 'kodex 200', quantity: 420, currency: 'KRW', exchange: 'KRX' })
    expect(valueHolding(kodex, 38_500, 1, 13_482_000, { quoteCurrency: 'krw' }).marketValueKrw).toBe(
      16_170_000,
    )
  })

  it('does not check the currency of a hand-entered price, which is given in the row\'s own', () => {
    const dgro = holding({ name: 'dgro', currency: 'KRW', exchange: 'KRX', quantity: 80 })
    const valued = valueHolding(dgro, 85_000, 1, 4_992_000, {
      manualPrice: true,
      quoteCurrency: 'USD',
    })
    expect(valued.marketValueKrw).toBe(6_800_000)
  })

  it('marks a hand-entered price, so it is distinguishable from a fetched one', () => {
    const valued = valueHolding(holding({ name: '한국증권금융' }), 2_780, 9, 10_000_000, {
      manualPrice: true,
    })
    expect(valued.manualPrice).toBe(true)
    expect(valued.marketValueKrw).toBe(10_008_000)
  })
})

describe('isCashLike', () => {
  it('recognises the sheet\'s cash marker and a blank ticker', () => {
    expect(isCashLike(holding({ ticker: 'cash' }))).toBe(true)
    expect(isCashLike(holding({ ticker: 'CASH' }))).toBe(true)
    expect(isCashLike(holding({ ticker: '  ' }))).toBe(true)
  })

  it('does not mistake a listed holding for cash', () => {
    expect(isCashLike(holding({ ticker: '8058.T' }))).toBe(false)
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
    const summary = summariseValues([valueHolding(holding(), null, null, null)])
    expect(summary.marketValueKrw).toBe(0)
    expect(summary.returnPct).toBeNull()
    expect(summary.unvalued).toHaveLength(1)
  })
})
