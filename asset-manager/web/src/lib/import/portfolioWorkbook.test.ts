import { describe, expect, it } from 'vitest'
import type { Sheet } from '../google/sheets'
import {
  SheetShapeError,
  currencyOfExchange,
  missingMonths,
  parseHoldingsInput,
  parseNavSheet,
} from './portfolioWorkbook'

type Cell = string | number | null
function sheetOf(values: Cell[][]): Sheet {
  return {
    properties: { sheetId: 1, title: 't', index: 0 },
    data: [
      {
        rowData: values.map((row) => ({
          values: row.map((cell) => {
            if (cell === null) return {}
            if (typeof cell === 'string') return { formattedValue: cell }
            return { formattedValue: String(cell), effectiveValue: { numberValue: cell } }
          }),
        })),
      },
    ],
  }
}

/**
 * 기준가(월): A 년, B 일자, C 입출금, D 평가금액, E 수익률, F 수익, G 누적입금,
 * H 누적수익, I 조정, J 기준가(좌), K 그래프일자, L kospi.
 */
function navSheet(rows: Cell[][] = []): Sheet {
  const header: Cell[] = [
    '년', '일자', '입출금', '평가금액', '수익률', '수익', '누적입금',
    '누적수익', '조정초기기준가', '기준가(좌)', '그래프일자', 'kospi',
  ]
  return sheetOf([header, ...rows])
}

/** 입출금 100 → 평가금액 100; then +50 in and +10 of growth. */
function navRows(): Cell[][] {
  return [
    [2011, '201105', 100, 100, 0, null, 100, 0, 1000, 1000, null, 2100],
    // ΔD 60 − CF 50 = 10 profit, cumulative in 150.
    [2011, '201106', 50, 160, 10, 10, 150, 10, 1000, 1090, null, 2200],
    // No cash flow, value falls 20.
    [2011, '201107', 0, 140, -12.5, -20, 150, -10, 1000, 953, null, 2050],
  ]
}

describe('currencyOfExchange', () => {
  it('reads the exchange, not the region', () => {
    // tiger 미국나스닥100 is US-exposed but settles in won.
    expect(currencyOfExchange('KRX')).toBe('KRW')
    expect(currencyOfExchange('kosdaq')).toBe('KRW')
    expect(currencyOfExchange('USD')).toBe('USD')
    expect(currencyOfExchange('JPX')).toBe('JPY')
  })

  it('ignores case and surrounding space', () => {
    expect(currencyOfExchange(' usd ')).toBe('USD')
    expect(currencyOfExchange('jpx')).toBe('JPY')
  })

  it('falls back to won for anything unlabelled', () => {
    // This workbook is a Korean brokerage account; won is the safe default and a
    // wrong foreign guess would silently misconvert.
    expect(currencyOfExchange('')).toBe('KRW')
    expect(currencyOfExchange('???')).toBe('KRW')
  })
})

describe('parseNavSheet', () => {
  it('keeps only the four originals', () => {
    const { navs } = parseNavSheet(navSheet(navRows()))
    expect(navs).toEqual([
      { ym: '2011-05', cashFlow: 100, marketValue: 100, nav: 1000, benchmark: 2100 },
      { ym: '2011-06', cashFlow: 50, marketValue: 160, nav: 1090, benchmark: 2200 },
      { ym: '2011-07', cashFlow: 0, marketValue: 140, nav: 953, benchmark: 2050 },
    ])
  })

  it('reports the range it covers', () => {
    const parsed = parseNavSheet(navSheet(navRows()))
    expect(parsed.firstYm).toBe('2011-05')
    expect(parsed.lastYm).toBe('2011-07')
  })

  it('agrees with the sheet on 누적입금 and 수익', () => {
    // Both are arithmetic the sheet already did, so agreement proves we read the
    // right columns and lined up the months.
    expect(parseNavSheet(navSheet(navRows())).mismatches).toEqual([])
  })

  it('reports a 누적입금 that does not match the running sum', () => {
    const rows = navRows()
    rows[1]![6] = 999
    const { mismatches } = parseNavSheet(navSheet(rows))
    expect(mismatches).toEqual([
      { ym: '2011-06', kind: 'cumulativeIn', ours: 150, sheet: 999, diff: -849 },
    ])
  })

  it('reports a 수익 that does not match Δ평가금액 − 입출금', () => {
    const rows = navRows()
    rows[2]![5] = 0
    const { mismatches } = parseNavSheet(navSheet(rows))
    expect(mismatches).toEqual([{ ym: '2011-07', kind: 'profit', ours: -20, sheet: 0, diff: -20 }])
  })

  it('finds the columns by header text, not by position', () => {
    // A column inserted at the front must not shift the mapping.
    const header: Cell[] = ['메모', '년', '일자', '입출금', '평가금액', '기준가(좌)', 'kospi']
    const sheet = sheetOf([header, ['x', 2011, '201105', 10, 100, 1000, 2100]])
    expect(parseNavSheet(sheet).navs).toEqual([
      { ym: '2011-05', cashFlow: 10, marketValue: 100, nav: 1000, benchmark: 2100 },
    ])
  })

  it('names the column it could not find rather than guessing', () => {
    const sheet = sheetOf([['년', '일자', '평가금액'], [2011, '201105', 100]])
    expect(() => parseNavSheet(sheet)).toThrow(SheetShapeError)
    expect(() => parseNavSheet(sheet)).toThrow('입출금')
  })

  it('reports no gaps for a contiguous run', () => {
    expect(parseNavSheet(navSheet(navRows())).gaps).toEqual([])
  })

  it('names a month missing from the middle', () => {
    const [first, , third] = navRows()
    expect(parseNavSheet(navSheet([first!, third!])).gaps).toEqual(['2011-06'])
  })

  it('sorts by month regardless of row order', () => {
    const [first, second, third] = navRows()
    const { navs } = parseNavSheet(navSheet([third!, first!, second!]))
    expect(navs.map((n) => n.ym)).toEqual(['2011-05', '2011-06', '2011-07'])
  })

  it('treats a missing 입출금 cell as no cash flow, not as a skipped month', () => {
    const sheet = navSheet([[2011, '201105', null, 100, null, null, null, null, null, 1000, null, 2100]])
    const { navs, skippedRows } = parseNavSheet(sheet)
    expect(navs[0]!.cashFlow).toBe(0)
    expect(skippedRows).toBe(0)
  })

  it('omits the benchmark rather than inventing a zero', () => {
    const sheet = sheetOf([
      ['일자', '입출금', '평가금액', '기준가(좌)'],
      ['201105', 10, 100, 1000],
    ])
    expect(parseNavSheet(sheet).navs[0]).toEqual({
      ym: '2011-05',
      cashFlow: 10,
      marketValue: 100,
      nav: 1000,
    })
  })
})

/** 입력정보: B 계좌주, C 계좌, D 종목, E ticker, F 수량, G 단가, … */
function holdingsSheet(rows: Cell[][] = []): Sheet {
  return sheetOf([
    ['자산운용', null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [
      null, '계좌주', '계좌', '종목', 'ticker', '수량', '단가', '배당', '배당금', '세후배당',
      '수량*매입단가', '평가금액', '구분', '지역', null,
    ],
    ...rows,
  ])
}

function holdingRows(): Cell[][] {
  return [
    [null, '호빵', '유안타주식', 'kodex 200', '069500', 10, 30000, 500, 5000, 4230, 300000, null, '성장', '국내', 'KRX'],
    [null, '쏘', '미래해외', 'Tesla', 'TSLA', 5, 200, 0, 0, 0, 1000, null, '성장', '미국', 'USD'],
    [null, '호빵', '미래해외', '미쓰비시상사', '8058', 100, 2500, 70, 7000, 5920, 250000, null, '배당', '일본', 'JPX'],
    [null, '호빵', '키움1', 'tiger 미국나스닥100', '133690', 20, 15000, 0, 0, 0, 300000, null, '성장', '미국', 'KRX'],
  ]
}

describe('parseHoldingsInput', () => {
  it('reads a position with its owner, account and classification', () => {
    const { holdings } = parseHoldingsInput(holdingsSheet(holdingRows()))
    expect(holdings).toHaveLength(4)
    expect(holdings[0]).toEqual({
      id: 'h1',
      owner: '호빵',
      account: '유안타주식',
      name: 'kodex 200',
      ticker: '069500',
      quantity: 10,
      avgPrice: 30000,
      costNative: 300000,
      priceScale: 1,
      dividendPerShare: 500,
      style: '성장',
      region: '국내',
      exchange: 'KRX',
      currency: 'KRW',
    })
  })

  it('takes the currency from the exchange even when the region is foreign', () => {
    // The case that makes region-based conversion wrong.
    const { holdings } = parseHoldingsInput(holdingsSheet(holdingRows()))
    const tiger = holdings.find((h) => h.name === 'tiger 미국나스닥100')!
    expect(tiger.region).toBe('미국')
    expect(tiger.currency).toBe('KRW')

    expect(holdings.find((h) => h.name === 'Tesla')!.currency).toBe('USD')
    expect(holdings.find((h) => h.name === '미쓰비시상사')!.currency).toBe('JPY')
  })

  it('agrees with the sheet on 수량 × 단가 for won holdings', () => {
    expect(parseHoldingsInput(holdingsSheet(holdingRows())).mismatches).toEqual([])
  })

  it('reports a won row whose cost does not match quantity times price', () => {
    const rows = holdingRows()
    rows[0]![10] = 1
    const { mismatches } = parseHoldingsInput(holdingsSheet(rows))
    expect(mismatches).toEqual([{ name: 'kodex 200', ours: 300000, sheet: 1, diff: 299999 }])
  })

  it('does not call a converted foreign cost a mismatch', () => {
    // 매입원가 is a won column for every holding, so it is never 수량 × 단가 for a
    // foreign one. Treating it as one blocked the whole import.
    const rows = holdingRows()
    rows[2]![10] = 784083
    const { mismatches } = parseHoldingsInput(holdingsSheet(rows))
    expect(mismatches).toEqual([])
  })

  it('reads the yen 100x scale out of the sheet, and keeps the sheet\'s own cost', () => {
    // The real case: 수량 × 단가 is 100× 매입원가, because 단가 was multiplied by a
    // 원/100엔 rate without dividing by 100. Both columns are **yen**; the ratio
    // only ever said they share a unit, not which one (see docs/06 §4.3).
    const rows = holdingRows()
    rows[2]![5] = 31_363
    rows[2]![6] = 2_500
    rows[2]![10] = 784_075
    const { holdings, priceScales } = parseHoldingsInput(holdingsSheet(rows))

    const yen = holdings.find((holding) => holding.name === '미쓰비시상사')!
    expect(yen.costNative).toBe(784_075)
    expect(yen.priceScale).toBeCloseTo(0.01)

    const scale = priceScales.find((entry) => entry.currency === 'JPY')!
    expect(scale.raw).toBe(78_407_500)
    expect(scale.costNative).toBe(784_075)
    expect(scale.scale).toBeCloseTo(0.01)
  })

  it('reports a scale of 1 for a dollar holding, as observed', () => {
    const scale = parseHoldingsInput(holdingsSheet(holdingRows())).priceScales.find(
      (entry) => entry.currency === 'USD',
    )!
    expect(scale.scale).toBeCloseTo(1)
  })

  it('names a position whose 매입원가 cell is blank instead of guessing', () => {
    // Falling back to 수량 × 단가 silently is how the yen amounts came out 100×
    // too large in the first place.
    const rows = holdingRows()
    rows[2]![10] = null
    const { holdings, costlessRows } = parseHoldingsInput(holdingsSheet(rows))

    expect(costlessRows).toEqual(['미쓰비시상사'])
    expect(holdings.find((holding) => holding.name === '미쓰비시상사')!.costNative).toBeUndefined()
  })

  it('tolerates rounding on a decimal price rather than crying mismatch', () => {
    // Tesla at 214.3 × 5 = 1071.5; a sheet rounding to 1071 is not an error.
    const rows = holdingRows()
    rows[1]![6] = 214.3
    rows[1]![10] = 1071
    expect(parseHoldingsInput(holdingsSheet(rows)).mismatches).toEqual([])
  })

  it('skips rows with no 종목 name', () => {
    const rows = holdingRows()
    rows.push([null, '호빵', '키움1', '', '', null, null, null, null, null, null, null, '', '', ''])
    const { holdings, skippedRows } = parseHoldingsInput(holdingsSheet(rows))
    expect(holdings).toHaveLength(4)
    expect(skippedRows).toBe(0)
  })

  it('counts a row that has a quantity but no name, instead of dropping it silently', () => {
    const rows = holdingRows()
    rows.push([null, '호빵', '키움1', '', '', 10, 100, null, null, null, null, null, '', '', 'KRX'])
    expect(parseHoldingsInput(holdingsSheet(rows)).skippedRows).toBe(1)
  })

  it('names the column it could not find', () => {
    const sheet = sheetOf([['계좌주', '계좌'], ['호빵', '유안타주식']])
    expect(() => parseHoldingsInput(sheet)).toThrow('종목')
  })
})

describe('missingMonths', () => {
  it('finds a single gap', () => {
    expect(missingMonths(['2011-05', '2011-07'])).toEqual(['2011-06'])
  })

  it('finds a run of gaps and crosses the year boundary', () => {
    expect(missingMonths(['2011-11', '2012-02'])).toEqual(['2011-12', '2012-01'])
  })

  it('is empty for a contiguous run', () => {
    expect(missingMonths(['2011-05', '2011-06', '2011-07'])).toEqual([])
  })

  it('does not care about input order', () => {
    expect(missingMonths(['2011-07', '2011-05'])).toEqual(['2011-06'])
  })

  it('has nothing to say about fewer than two months', () => {
    expect(missingMonths([])).toEqual([])
    expect(missingMonths(['2011-05'])).toEqual([])
  })

  it('reports nothing for the real range, which is 184 months', () => {
    // 2011-05 through 2026-08 inclusive is 184 months, not 185 — the count
    // follows from the range, so a complete run is not evidence of a drop.
    const months: string[] = []
    for (let index = 2011 * 12 + 4; index <= 2026 * 12 + 7; index++) {
      months.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`)
    }
    expect(months).toHaveLength(184)
    expect(months[0]).toBe('2011-05')
    expect(months.at(-1)).toBe('2026-08')
    expect(missingMonths(months)).toEqual([])
  })
})
