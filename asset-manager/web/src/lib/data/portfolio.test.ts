import { describe, expect, it } from 'vitest'
import {
  avgPriceKrw,
  byOwner,
  compositionAt,
  costOf,
  dimensionKeys,
  indexToBase,
  owners,
  recentNavs,
  summariseNavs,
} from './portfolio'
import type { Holding, PortfolioNav } from './model'

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

describe('compositionAt', () => {
  const mixed = [
    holding({ id: 'h1', style: '성장', currency: 'KRW', quantity: 10, avgPrice: 30000, costKrw: 300_000 }),
    holding({ id: 'h2', style: '배당', currency: 'KRW', quantity: 10, avgPrice: 10000, costKrw: 100_000 }),
    holding({ id: 'h3', style: '성장', currency: 'USD', quantity: 5, avgPrice: 280_000, costKrw: 1_400_000 }),
    // Yen: 단가 carries 100×, so only costKrw is right.
    holding({
      id: 'h4',
      style: '배당',
      currency: 'JPY',
      quantity: 400,
      avgPrice: 2_500_000,
      costKrw: 10_000_000,
      priceScale: 0.01,
    }),
  ]

  it('adds every currency together, because the costs are all won', () => {
    // This used to split by currency, on the mistaken belief that costs were in
    // each holding's own currency and needed a rate before they could be summed.
    const { total, slices } = compositionAt(mixed, 'style')
    expect(total).toBe(11_800_000)
    expect(slices.map((slice) => slice.key)).toEqual(['배당', '성장'])
    expect(slices[0]!.cost).toBe(10_100_000)
    expect(slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1)
  })

  it('groups by currency with the same function', () => {
    const { slices } = compositionAt(mixed, 'currency')
    expect(slices.map((slice) => slice.key)).toEqual(['JPY', 'USD', 'KRW'])
    expect(slices.find((slice) => slice.key === 'JPY')!.cost).toBe(10_000_000)
  })

  it('groups by region, account and owner too', () => {
    expect(compositionAt(mixed, 'region').slices[0]!.key).toBe('국내')
    expect(compositionAt(mixed, 'account').slices[0]!.key).toBe('유안타주식')
    expect(compositionAt(mixed, 'owner').slices[0]!.key).toBe('호빵')
  })

  it('labels a blank classification rather than dropping the holding', () => {
    expect(compositionAt([holding({ style: '', costKrw: 1000 })], 'style').slices[0]!.key).toBe('미분류')
  })

  it('leaves out a position with no cost, which would be a zero-width segment', () => {
    expect(compositionAt([holding({ quantity: 0, avgPrice: 0 })], 'style').slices).toEqual([])
  })
})

describe('costOf', () => {
  it('takes the sheet\'s own won figure when it has one', () => {
    // 수량 × 단가 would be 100× for a yen holding, so the sheet wins.
    expect(costOf(holding({ quantity: 400, avgPrice: 2_500_000, costKrw: 10_000_000 }))).toBe(10_000_000)
  })

  it('falls back to quantity times price when the cell was blank', () => {
    expect(costOf(holding({ quantity: 10, avgPrice: 30000 }))).toBe(300000)
  })
})

describe('avgPriceKrw', () => {
  it('applies the scale, so a yen 단가 reads as won', () => {
    expect(avgPriceKrw(holding({ avgPrice: 2_500_000, priceScale: 0.01 }))).toBe(25_000)
  })

  it('leaves a price alone when there is no scale', () => {
    expect(avgPriceKrw(holding({ avgPrice: 30_000 }))).toBe(30_000)
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
