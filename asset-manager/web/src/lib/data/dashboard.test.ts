import { describe, expect, it } from 'vitest'
import {
  changeAgainstPrevious,
  monthlyTotals,
  summariseMonth,
  trailingMonths,
  type MonthTotals,
} from './dashboard'
import { emptyData, type AssetData } from './model'

function data(): AssetData {
  return {
    ...emptyData(),
    categories: [
      { id: 'c1', kind: 'ASSET', name: '현금성자산', color: 'a', order: 1 },
      { id: 'c2', kind: 'ASSET', name: '주식및투자', color: 'b', order: 2 },
      { id: 'c3', kind: 'DEBT', name: '마통', color: 'c', order: 3 },
      { id: 'c4', kind: 'DEBT', name: '부채', color: 'd', order: 4 },
    ],
    items: [
      { id: 'i1', categoryId: 'c1', name: '보통예금', currency: 'KRW', hidden: false, order: 1 },
      { id: 'i2', categoryId: 'c2', name: '증권', currency: 'KRW', hidden: false, order: 2 },
      { id: 'i3', categoryId: 'c3', name: '마통', currency: 'KRW', hidden: false, order: 3 },
      { id: 'i4', categoryId: 'c4', name: '주택담보대출', currency: 'KRW', hidden: false, order: 4 },
    ],
    snapshots: [
      { itemId: 'i1', ym: '2026-01', amount: 1000 },
      { itemId: 'i2', ym: '2026-01', amount: 3000 },
      { itemId: 'i3', ym: '2026-01', amount: -500 },
      { itemId: 'i4', ym: '2026-01', amount: -2000 },

      { itemId: 'i1', ym: '2026-02', amount: 1200 },
      { itemId: 'i2', ym: '2026-02', amount: 3300 },
      // 마통 in credit: stored positive, so it offsets the debt.
      { itemId: 'i3', ym: '2026-02', amount: 400 },
      { itemId: 'i4', ym: '2026-02', amount: -1900 },
    ],
  }
}

describe('monthlyTotals', () => {
  it('sums assets and debts per month in display sign', () => {
    expect(monthlyTotals(data())).toEqual([
      { ym: '2026-01', asset: 4000, debt: 2500, net: 1500 },
      // 주택담보대출 1900 less the 400 sitting in the 마통 account.
      { ym: '2026-02', asset: 4500, debt: 1500, net: 3000 },
    ])
  })

  it('orders by month regardless of snapshot order', () => {
    const shuffled = data()
    shuffled.snapshots = [...shuffled.snapshots].reverse()
    expect(monthlyTotals(shuffled).map((month) => month.ym)).toEqual(['2026-01', '2026-02'])
  })

  it('omits months with no records rather than reporting zero', () => {
    // A month absent from the data is "not entered", which is a different fact.
    expect(monthlyTotals(data()).map((month) => month.ym)).not.toContain('2026-03')
    expect(monthlyTotals(emptyData())).toEqual([])
  })
})

describe('summariseMonth', () => {
  it('reports totals, net worth and leverage', () => {
    const summary = summariseMonth(data(), '2026-01')!
    expect(summary.asset).toBe(4000)
    expect(summary.debt).toBe(2500)
    expect(summary.net).toBe(1500)
    expect(summary.leverage).toBeCloseTo(62.5)
  })

  it('splits assets into shares of the bar, largest first', () => {
    const { assets } = summariseMonth(data(), '2026-01')!
    expect(assets.map((slice) => slice.name)).toEqual(['주식및투자', '현금성자산'])
    expect(assets[0]!.amount).toBe(3000)
    expect(assets[0]!.share).toBeCloseTo(0.75)
    expect(assets.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1)
  })

  it('keeps a 마통 in credit out of the debt bar and reports it as an offset', () => {
    // A credit balance is not a component of what the debt is made of, so it
    // cannot be a segment; a negative segment would have no sensible width.
    const summary = summariseMonth(data(), '2026-02')!
    expect(summary.debts.map((slice) => slice.name)).toEqual(['부채'])
    expect(summary.debtOffsets.map((slice) => slice.name)).toEqual(['마통'])
    expect(summary.debtOffsets[0]!.amount).toBe(-400)
    // The bar's segments still fill it, and the total still nets the offset out.
    expect(summary.debts[0]!.share).toBeCloseTo(1)
    expect(summary.debt).toBe(1500)
  })

  it('treats a 마통 that owes money as an ordinary debt segment', () => {
    const summary = summariseMonth(data(), '2026-01')!
    expect(summary.debts.map((slice) => slice.name)).toEqual(['부채', '마통'])
    expect(summary.debtOffsets).toEqual([])
  })

  it('returns null for a month with no records', () => {
    expect(summariseMonth(data(), '2020-05')).toBeNull()
  })

  it('leaves leverage null rather than dividing by zero', () => {
    const noAssets = data()
    noAssets.snapshots = [{ itemId: 'i4', ym: '2026-01', amount: -2000 }]
    expect(summariseMonth(noAssets, '2026-01')!.leverage).toBeNull()
  })
})

describe('an item already counted inside another one', () => {
  /** 마통 (i3) is contained in 은행부채, so no total may add it again. */
  function contained(): AssetData {
    const base = data()
    return {
      ...base,
      items: base.items.map((item) =>
        item.id === 'i3' ? { ...item, countedElsewhere: '은행부채에 포함' } : item,
      ),
    }
  }

  it('is left out of the monthly totals, on both sides', () => {
    expect(monthlyTotals(contained())).toEqual([
      // 마통 −500 no longer added to the 2,000 mortgage...
      { ym: '2026-01', asset: 4000, debt: 2000, net: 2000 },
      // ...nor its credit balance subtracted from the 1,900 one.
      { ym: '2026-02', asset: 4500, debt: 1900, net: 2600 },
    ])
  })

  it('does not leak into assets', () => {
    // "debt, otherwise asset" would silently bank it as an asset.
    expect(monthlyTotals(contained())[0]!.asset).toBe(4000)
  })

  it('is kept out of the composition bars', () => {
    // A segment has to be part of the total the bar breaks down.
    const summary = summariseMonth(contained(), '2026-01')!
    expect(summary.debts.map((slice) => slice.name)).toEqual(['부채'])
    expect(summary.debts[0]!.share).toBeCloseTo(1)
    expect(summary.debtOffsets).toEqual([])
  })

  it('is reported with its reason, so the total never quietly disagrees', () => {
    const summary = summariseMonth(contained(), '2026-01')!
    expect(summary.excluded).toEqual([
      { itemId: 'i3', name: '마통', amount: 500, reason: '은행부채에 포함' },
    ])
  })

  it('still marks the month as having records', () => {
    const onlyExcluded = contained()
    onlyExcluded.snapshots = [{ itemId: 'i3', ym: '2026-01', amount: -500 }]
    const summary = summariseMonth(onlyExcluded, '2026-01')
    expect(summary).not.toBeNull()
    expect(summary!.debt).toBe(0)
    expect(monthlyTotals(onlyExcluded).map((month) => month.ym)).toEqual(['2026-01'])
  })
})

describe('changeAgainstPrevious', () => {
  const totals: MonthTotals[] = [
    { ym: '2026-01', asset: 4000, debt: 2500, net: 1500 },
    { ym: '2026-02', asset: 4500, debt: 1500, net: 3000 },
  ]

  it('names the month it compared against', () => {
    const change = changeAgainstPrevious(totals, '2026-02', (month) => month.net)!
    expect(change.fromYm).toBe('2026-01')
    expect(change.delta).toBe(1500)
    expect(change.percent).toBeCloseTo(100)
  })

  it('compares against the previous recorded month, not the previous calendar month', () => {
    // With a gap, "전월 대비" would be a lie; the caller shows fromYm instead.
    const gapped: MonthTotals[] = [
      { ym: '2025-08', asset: 100, debt: 0, net: 100 },
      { ym: '2026-02', asset: 300, debt: 0, net: 300 },
    ]
    expect(changeAgainstPrevious(gapped, '2026-02', (month) => month.net)!.fromYm).toBe('2025-08')
  })

  it('has nothing to compare for the first month or an unknown one', () => {
    expect(changeAgainstPrevious(totals, '2026-01', (month) => month.net)).toBeNull()
    expect(changeAgainstPrevious(totals, '2030-01', (month) => month.net)).toBeNull()
  })

  it('leaves percent null when the earlier value was zero', () => {
    const fromZero: MonthTotals[] = [
      { ym: '2026-01', asset: 0, debt: 0, net: 0 },
      { ym: '2026-02', asset: 500, debt: 0, net: 500 },
    ]
    const change = changeAgainstPrevious(fromZero, '2026-02', (month) => month.net)!
    expect(change.delta).toBe(500)
    expect(change.percent).toBeNull()
  })

  it('reports a percent against a negative base without flipping the direction', () => {
    // Net worth was negative and improved; the change is positive.
    const negative: MonthTotals[] = [
      { ym: '2026-01', asset: 100, debt: 300, net: -200 },
      { ym: '2026-02', asset: 100, debt: 200, net: -100 },
    ]
    const change = changeAgainstPrevious(negative, '2026-02', (month) => month.net)!
    expect(change.delta).toBe(100)
    expect(change.percent).toBeCloseTo(50)
  })
})

describe('trailingMonths', () => {
  const totals: MonthTotals[] = Array.from({ length: 20 }, (_, index) => ({
    ym: `2025-${String(index + 1).padStart(2, '0')}`,
    asset: index,
    debt: 0,
    net: index,
  }))

  it('takes the window ending at the given month', () => {
    const window = trailingMonths(totals, '2025-12', 12)
    expect(window).toHaveLength(12)
    expect(window[0]!.ym).toBe('2025-01')
    expect(window.at(-1)!.ym).toBe('2025-12')
  })

  it('returns what exists when there is less history than asked for', () => {
    expect(trailingMonths(totals, '2025-03', 12).map((month) => month.ym)).toEqual([
      '2025-01',
      '2025-02',
      '2025-03',
    ])
  })

  it('is empty for a month that holds no records', () => {
    expect(trailingMonths(totals, '1999-01', 12)).toEqual([])
  })
})
