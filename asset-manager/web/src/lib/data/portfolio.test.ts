import { describe, expect, it } from 'vitest'
import {
  avgPriceNative,
  byOwner,
  compositionAt,
  costKrwOf,
  costOf,
  dimensionKeys,
  indexToBase,
  owners,
  recentNavs,
  summariseNavs,
} from './portfolio'
import type { CurrencyCode, Holding, PortfolioNav } from './model'
import type { Valued } from '../quotes/valuation'

function navs(): PortfolioNav[] {
  return [
    { ym: '2011-05', cashFlow: 100, marketValue: 100, nav: 1000, benchmark: 2000 },
    { ym: '2011-06', cashFlow: 50, marketValue: 160, nav: 1090, benchmark: 2100 },
    { ym: '2011-07', cashFlow: 0, marketValue: 200, nav: 1250, benchmark: 2200 },
  ]
}

function holding(partial: Partial<Holding> = {}): Holding {
  return {
    id: 'h1',
    owner: '호빵',
    account: '유안타주식',
    name: 'kodex 200',
    ticker: '069500',
    quantity: 10,
    avgPrice: 1000,
    style: '성장',
    region: '국내',
    exchange: 'KRX',
    currency: 'KRW',
    ...partial,
  }
}

describe('summariseNavs', () => {
  it('reports the last month held', () => {
    const summary = summariseNavs(navs())!
    expect(summary.ym).toBe('2011-07')
    expect(summary.marketValue).toBe(200)
    expect(summary.nav).toBe(1250)
  })

  it('sums deposits and derives profit from them', () => {
    const summary = summariseNavs(navs())!
    expect(summary.cumulativeIn).toBe(150)
    expect(summary.cumulativeProfit).toBe(50)
  })

  it('takes return from the 기준가, not from profit over deposits', () => {
    // 1000 → 1250 is 25%, unaffected by when the 50 arrived. Profit over
    // deposits would say 33% and would move if the deposit had been timed
    // differently, which is not a fact about performance.
    expect(summariseNavs(navs())!.returnPct).toBeCloseTo(25)
  })

  it('compares against the benchmark in percentage points', () => {
    const summary = summariseNavs(navs())!
    expect(summary.benchmarkReturnPct).toBeCloseTo(10)
    expect(summary.excessPct).toBeCloseTo(15)
  })

  it('leaves the benchmark null when the sheet has none', () => {
    const withoutBenchmark = navs().map(({ benchmark: _benchmark, ...rest }) => rest)
    const summary = summariseNavs(withoutBenchmark)!
    expect(summary.benchmarkReturnPct).toBeNull()
    expect(summary.excessPct).toBeNull()
  })

  it('sorts before summarising, so row order cannot change the answer', () => {
    const summary = summariseNavs([...navs()].reverse())!
    expect(summary.ym).toBe('2011-07')
    expect(summary.returnPct).toBeCloseTo(25)
  })

  it('returns null when nothing has been imported', () => {
    expect(summariseNavs([])).toBeNull()
  })

  it('reports a loss as a negative return', () => {
    const losing: PortfolioNav[] = [
      { ym: '2011-05', cashFlow: 100, marketValue: 100, nav: 1000 },
      { ym: '2011-06', cashFlow: 0, marketValue: 80, nav: 800 },
    ]
    const summary = summariseNavs(losing)!
    expect(summary.returnPct).toBeCloseTo(-20)
    expect(summary.cumulativeProfit).toBe(-20)
  })
})

describe('recentNavs', () => {
  it('takes the last months, in order', () => {
    expect(recentNavs(navs(), 2).map((n) => n.ym)).toEqual(['2011-06', '2011-07'])
  })

  it('returns everything when asked for more than exists', () => {
    expect(recentNavs(navs(), 60)).toHaveLength(3)
  })
})

describe('indexToBase', () => {
  it('rebases to 100 at the first value', () => {
    const indexed = indexToBase([1000, 1090, 1250])
    expect(indexed[0]).toBeCloseTo(100)
    expect(indexed[1]).toBeCloseTo(109)
    expect(indexed[2]).toBeCloseTo(125)
  })

  it('puts two different scales on one comparable footing', () => {
    // The reason this exists: 기준가 near 1000 and KOSPI near 2000 would
    // otherwise need two y-scales, whose alignment is arbitrary. Indexed, a 25%
    // gain and a 10% gain are directly comparable on one axis.
    const fund = indexToBase([1000, 1090, 1250])
    const benchmark = indexToBase([2000, 2100, 2200])
    expect(fund.at(-1)!).toBeCloseTo(125)
    expect(benchmark.at(-1)!).toBeCloseTo(110)
  })

  it('keeps gaps as gaps rather than turning them into zero', () => {
    expect(indexToBase([1000, null, 1250])).toEqual([100, null, 125])
  })

  it('bases on the first non-zero value rather than dividing by zero', () => {
    // The zero stays zero — it is a real reading, and relative to the base it
    // genuinely is nothing.
    expect(indexToBase([0, 50, 100])).toEqual([0, 100, 200])
  })

  it('is all null when there is nothing to base on', () => {
    expect(indexToBase([])).toEqual([])
    expect(indexToBase([null, null])).toEqual([null, null])
  })
})

describe('owners and filtering', () => {
  const holdings = [
    holding({ id: 'h1', owner: '호빵' }),
    holding({ id: 'h2', owner: '쏘' }),
    holding({ id: 'h3', owner: '호빵' }),
  ]

  it('lists owners in first-seen order, without duplicates', () => {
    expect(owners(holdings)).toEqual(['호빵', '쏘'])
  })

  it('aggregates everything when no owner is chosen', () => {
    expect(byOwner(holdings, null)).toHaveLength(3)
  })

  it('narrows to one owner when asked', () => {
    expect(byOwner(holdings, '호빵').map((h) => h.id)).toEqual(['h1', 'h3'])
  })
})

/** 원 per ONE unit, the only unit `krwPerUnit` accepts. */
const RATES: ReadonlyMap<CurrencyCode, number> = new Map<CurrencyCode, number>([
  ['USD', 1400],
  ['JPY', 9],
])

describe('compositionAt', () => {
  /** Market value is what the bars draw; cost is the fallback before any quote. */
  const marketValue = (row: Valued) => row.marketValueKrw
  const cost = (row: Valued) => row.costKrw

  /** A row valued at `marketValueKrw`, the shape `Portfolio` hands in. */
  function row(partial: Partial<Holding>, marketValueKrw: number | null, costKrw = 0): Valued {
    const one = holding(partial)
    return {
      holding: one,
      price: marketValueKrw === null ? null : 1,
      rate: marketValueKrw === null ? null : 1,
      marketValueKrw,
      costKrw,
      gainKrw: null,
      returnPct: null,
    }
  }

  const mixed = [
    row({ id: 'h1', style: '성장', currency: 'KRW' }, 400_000, 300_000),
    row({ id: 'h2', style: '배당', currency: 'KRW' }, 150_000, 100_000),
    row({ id: 'h3', style: '성장', currency: 'USD' }, 1_400_000, 1_200_000),
    row({ id: 'h4', style: '배당', currency: 'JPY' }, 9_000_000, 8_000_000),
  ]

  it('adds market values up on one won scale', () => {
    const { total, slices, excluded } = compositionAt(mixed, 'style', marketValue)
    expect(total).toBe(400_000 + 150_000 + 1_400_000 + 9_000_000)
    expect(excluded).toEqual([])
    expect(slices.map((slice) => slice.key)).toEqual(['배당', '성장'])
    expect(slices[0]!.amount).toBe(150_000 + 9_000_000)
    expect(slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1)
  })

  it('groups by currency with the same function', () => {
    const { slices } = compositionAt(mixed, 'currency', marketValue)
    expect(slices.map((slice) => slice.key)).toEqual(['JPY', 'USD', 'KRW'])
    expect(slices.find((slice) => slice.key === 'JPY')!.amount).toBe(9_000_000)
  })

  it('draws cost when asked, which is the fallback before a quote arrives', () => {
    const { total, slices } = compositionAt(mixed, 'style', cost)
    expect(total).toBe(300_000 + 100_000 + 1_200_000 + 8_000_000)
    expect(slices[0]!.amount).toBe(100_000 + 8_000_000)
  })

  it('leaves out a row with no figure and names it, rather than adding zero', () => {
    // Silently adding 0 shrinks the total and redraws every other share, with
    // nothing on screen to say why.
    const withGap = [...mixed, row({ id: 'h5', name: '한국증권금융', style: '가치' }, null)]
    const { total, excluded } = compositionAt(withGap, 'style', marketValue)
    expect(total).toBe(400_000 + 150_000 + 1_400_000 + 9_000_000)
    expect(excluded).toEqual(['한국증권금융'])
  })

  it('groups by region, account and owner too', () => {
    expect(compositionAt(mixed, 'region', marketValue).slices[0]!.key).toBe('국내')
    expect(compositionAt(mixed, 'account', marketValue).slices[0]!.key).toBe('유안타주식')
    expect(compositionAt(mixed, 'owner', marketValue).slices[0]!.key).toBe('호빵')
  })

  it('labels a blank classification rather than dropping the holding', () => {
    expect(compositionAt([row({ style: '' }, 1000)], 'style', marketValue).slices[0]!.key).toBe(
      '미분류',
    )
  })

  it('leaves out a zero position, which would be a zero-width segment', () => {
    expect(compositionAt([row({}, 0)], 'style', marketValue).slices).toEqual([])
  })
})

describe('costOf', () => {
  it('takes the sheet\'s own figure, in the holding\'s own currency', () => {
    // 수량 × 단가 would be 100× for a yen holding, so the sheet wins.
    expect(costOf(holding({ quantity: 400, avgPrice: 250_000, costNative: 1_000_000 }))).toBe(1_000_000)
  })

  it('reads data written before the rename, where the same number was called costKrw', () => {
    // The value was always the native amount; only the label was wrong.
    expect(costOf(holding({ quantity: 400, avgPrice: 250_000, costKrw: 1_000_000 }))).toBe(1_000_000)
  })

  it('falls back to quantity times price when the cell was blank', () => {
    expect(costOf(holding({ quantity: 10, avgPrice: 30000 }))).toBe(300000)
  })

  it('ignores 매입원가 for cash and uses the amount held', () => {
    // A cash row's 단가 holds an exchange rate, so the two columns do not share a
    // unit the way a stock's do. Cash does not appreciate either, so 수량 is both
    // the cost and the value in its own currency.
    expect(costOf(holding({ ticker: 'cash', quantity: 86_667, costNative: 780_003 }))).toBe(86_667)
  })
})

describe('costKrwOf', () => {
  it('does not double the rate on a dollar cash row whose 단가 holds the rate', () => {
    // 수량 1,200 (달러), 단가 1,350 (환율), 매입원가 1,620,000 (이미 원화). Reading
    // 매입원가 here and converting it again gave 1,385× the truth.
    const cash = holding({
      name: '현금($)',
      ticker: 'USD',
      style: '현금',
      quantity: 1_200,
      avgPrice: 1_350,
      costNative: 1_620_000,
      currency: 'USD',
      exchange: 'USD',
    })
    expect(costOf(cash)).toBe(1_200)
    expect(costKrwOf(cash, RATES)).toBe(1_200 * 1400)
  })

  it('applies the rate, which is what foreign costs were missing', () => {
    expect(costKrwOf(holding({ currency: 'USD', costNative: 1_000 }), RATES)).toBe(1_400_000)
    expect(costKrwOf(holding({ currency: 'JPY', costNative: 1_000_000 }), RATES)).toBe(9_000_000)
  })

  it('needs no rate for won', () => {
    expect(costKrwOf(holding({ currency: 'KRW', costNative: 300_000 }), new Map())).toBe(300_000)
  })

  it('is null without a rate, never converted at 1', () => {
    expect(costKrwOf(holding({ currency: 'USD', costNative: 1_000 }), new Map())).toBeNull()
  })

  it('prices foreign cash at 수량 × 환율', () => {
    const yen = holding({ ticker: 'cash', currency: 'JPY', quantity: 86_667, costNative: 780_003 })
    expect(costKrwOf(yen, RATES)).toBe(86_667 * 9)
  })
})

describe('avgPriceNative', () => {
  it('applies the scale, so a yen 단가 reads as a per-share yen price', () => {
    expect(avgPriceNative(holding({ currency: 'JPY', avgPrice: 250_000, priceScale: 0.01 }))).toBe(2_500)
  })

  it('leaves a price alone when there is no scale', () => {
    expect(avgPriceNative(holding({ avgPrice: 30_000 }))).toBe(30_000)
  })

  it('is one unit for cash, matching its current price', () => {
    expect(avgPriceNative(holding({ ticker: 'cash', avgPrice: 900 }))).toBe(1)
  })
})

describe('dimensionKeys', () => {

  it('lists dimension values across every holding, so colours stay put', () => {
    // Taken from all holdings, not the visible ones: an owner filter must not
    // repaint the styles that survive it.
    const keys = dimensionKeys(
      [holding({ style: '성장' }), holding({ style: '배당' }), holding({ style: '성장' })],
      'style',
    )
    expect(keys).toEqual(['배당', '성장'])
  })

  it('includes a key that only an unselected owner holds', () => {
    // Otherwise switching owner would shift every colour slot along.
    const keys = dimensionKeys(
      [holding({ owner: '호빵', style: '성장' }), holding({ owner: '쏘', style: '현금' })],
      'style',
    )
    expect(keys).toEqual(['성장', '현금'])
  })
})
