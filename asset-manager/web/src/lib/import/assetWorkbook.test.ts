import { describe, expect, it } from 'vitest'
import type { Sheet } from '../google/sheets'
import { combine, crossCheck, parseBalanceSheet, parseHoldingsSheet } from './assetWorkbook'

/**
 * Builds a sheet from a grid of plain values. A cell may be a string (rendered
 * text), a number, or a [number, note] pair.
 */
type Cell = string | number | [number, string] | null
function sheetOf(values: Cell[][]): Sheet {
  return {
    properties: { sheetId: 1, title: 't', index: 0 },
    data: [
      {
        rowData: values.map((row) => ({
          values: row.map((cell) => {
            if (cell === null) return {}
            if (typeof cell === 'string') return { formattedValue: cell }
            if (typeof cell === 'number') {
              return { formattedValue: String(cell), effectiveValue: { numberValue: cell } }
            }
            const [value, note] = cell
            return { formattedValue: String(value), effectiveValue: { numberValue: value }, note }
          }),
        })),
      },
    ],
  }
}

/** The 잔액입력 shape: five header rows, then dated balance rows. */
function balanceSheet(): Sheet {
  return sheetOf([
    ['날짜', '국민은행', '국민은행', '신한은행', '우체국'],
    ['', '425301-01-254738', '425302-01-120137', '110-405-011937', ''],
    ['상세', '보통예금', '청약예금', '마통', '예금'],
    ['대분류', '현금성자산', '예적금', '마통', '예적금'],
    ['중분류', '수시입출', '정기예금', '마통', '정기예금'],
    ['2010-01-01', 1000, 2000, -500, null],
    ['2010-01-31', 1100, 2100, -400, 300],
    ['2010-02-28', [1200, '2월 입금'], 2200, -300, 300],
  ])
}

describe('parseBalanceSheet', () => {
  it('reads categories from row 4 and marks 마통 as debt', () => {
    const { categories } = parseBalanceSheet(balanceSheet())
    expect(categories.map((c) => c.name)).toEqual(['현금성자산', '예적금', '마통'])
    expect(categories.map((c) => c.kind)).toEqual(['ASSET', 'ASSET', 'DEBT'])
    // Order follows first appearance across the columns.
    expect(categories.map((c) => c.order)).toEqual([1, 2, 3])
  })

  it('names items 기관 + 상세 and keeps the column letter', () => {
    const { items } = parseBalanceSheet(balanceSheet())
    expect(items.map((i) => i.name)).toEqual([
      '국민은행 보통예금',
      '국민은행 청약예금',
      '신한은행 마통',
      '우체국 예금',
    ])
    expect(items.map((i) => i.sourceKey)).toEqual(['B', 'C', 'D', 'E'])
    expect(items.map((i) => i.subCategory)).toEqual(['수시입출', '정기예금', '마통', '정기예금'])
    expect(items.every((i) => i.currency === 'KRW')).toBe(true)
  })

  it('suffixes a repeated 기관 + 상세 instead of silently merging', () => {
    const sheet = sheetOf([
      ['날짜', '국민은행', '국민은행'],
      ['', 'a', 'b'],
      ['상세', '보통예금', '보통예금'],
      ['대분류', '현금성자산', '현금성자산'],
      ['중분류', '수시입출', '수시입출'],
      ['2010-01-31', 1, 2],
    ])
    const { items, renamedItems } = parseBalanceSheet(sheet)
    expect(items.map((i) => i.name)).toEqual(['국민은행 보통예금', '국민은행 보통예금 2'])
    expect(renamedItems).toEqual([
      { original: '국민은행 보통예금', assigned: '국민은행 보통예금 2', sourceKey: 'C' },
    ])
  })

  it('keeps the later row when a month repeats, and reports the dropped one', () => {
    const { snapshots, droppedRows, firstYm, lastYm } = parseBalanceSheet(balanceSheet())

    // 2010-01 appears twice (01-01 and 01-31); the month-end row wins.
    const january = snapshots.filter((s) => s.ym === '2010-01' && s.itemId === 'i1')
    expect(january).toHaveLength(1)
    expect(january[0]!.amount).toBe(1100)

    expect(droppedRows).toHaveLength(1)
    expect(droppedRows[0]!.ym).toBe('2010-01')
    expect(droppedRows[0]!.date).toBe('2010-01-01')

    expect(firstYm).toBe('2010-01')
    expect(lastYm).toBe('2010-02')
  })

  it('skips empty cells rather than storing zeroes', () => {
    const { snapshots } = parseBalanceSheet(balanceSheet())
    // 우체국 (i4) has no value in the 2010-01-01 row, and 2010-01-31 wins anyway.
    expect(snapshots.filter((s) => s.itemId === 'i4').map((s) => s.ym)).toEqual(['2010-01', '2010-02'])
  })

  it('carries a cell note onto the snapshot', () => {
    const { snapshots } = parseBalanceSheet(balanceSheet())
    const febrary = snapshots.find((s) => s.itemId === 'i1' && s.ym === '2010-02')
    expect(febrary?.memo).toBe('2월 입금')
  })

  it('preserves the negative sign 마통 already carries', () => {
    const { snapshots } = parseBalanceSheet(balanceSheet())
    expect(snapshots.find((s) => s.itemId === 'i3' && s.ym === '2010-02')?.amount).toBe(-300)
  })

  it('reports columns that have no 대분류 instead of guessing one', () => {
    const sheet = sheetOf([
      ['날짜', '국민은행', '???'],
      ['', 'a', ''],
      ['상세', '보통예금', '미분류'],
      ['대분류', '현금성자산', ''],
      ['중분류', '수시입출', ''],
      ['2010-01-31', 1, 2],
    ])
    const { items, unclassifiedColumns } = parseBalanceSheet(sheet)
    expect(items).toHaveLength(1)
    expect(unclassifiedColumns).toEqual(['C'])
  })

  it('accumulates per-category totals for the cross-check', () => {
    const { ownTotals } = parseBalanceSheet(balanceSheet())
    // 예적금 = 국민은행 청약예금 + 우체국 예금
    expect(ownTotals.get('예적금')?.get('2010-01')).toBe(2100 + 300)
    expect(ownTotals.get('현금성자산')?.get('2010-02')).toBe(1200)
  })
})

/** 자산보유현황: A date, B~H category totals, L~S debts, T total, X note. */
function holdingsSheet(): Sheet {
  const header: Cell[] = ['날짜', '현금성자산', '예적금', '주식및투자', 'ficc', '실물자산', '연금', '대여금']
  // Pad to column L (index 11) then the debt columns.
  while (header.length < 11) header.push(null)
  header.push('주택담보대출', '은행부채', '전세금')
  while (header.length < 19) header.push(null)
  header.push('부채')
  while (header.length < 23) header.push(null)
  header.push(null)

  const row = (date: string, cash: number, deposit: number, loan: number, bank: number, total: number, note: Cell) => {
    const cells: Cell[] = [date, cash, deposit, 0, 0, 0, 0, 0]
    while (cells.length < 11) cells.push(null)
    cells.push(loan, bank, null)
    while (cells.length < 19) cells.push(null)
    cells.push(total)
    while (cells.length < 23) cells.push(null)
    cells.push(note)
    return cells
  }

  return sheetOf([
    header,
    row('2010-01-31', 1100, 2400, 5000, 300, 5300, '결혼, 부동산매입'),
    row('2010-02-28', 1200, 2500, 4900, 200, 5100, null),
  ])
}

describe('parseHoldingsSheet', () => {
  it('reads debt columns from L onward and flips them negative', () => {
    const { items, snapshotsBySourceKey } = parseHoldingsSheet(holdingsSheet())
    // Every named debt column becomes an item, in column order.
    expect(items.map((i) => i.name)).toEqual(['주택담보대출', '은행부채', '전세금'])
    expect(items.map((i) => i.sourceKey)).toEqual(['L', 'M', 'N'])
    expect(items.every((i) => i.isLoan)).toBe(true)

    expect(snapshotsBySourceKey.get('L')).toEqual([
      { ym: '2010-01', amount: -5000 },
      { ym: '2010-02', amount: -4900 },
    ])
  })

  it('keeps a named column with no values as an item without snapshots', () => {
    // 전세금 is headed but blank in these rows; the item must still exist so a
    // later month with a value has somewhere to land.
    const { items, snapshotsBySourceKey } = parseHoldingsSheet(holdingsSheet())
    expect(items.map((i) => i.name)).toContain('전세금')
    expect(snapshotsBySourceKey.get('N')).toBeUndefined()
  })

  it('keeps B~H only as expected totals, never as items', () => {
    const { items, expectedTotals } = parseHoldingsSheet(holdingsSheet())
    expect(items.map((i) => i.name)).not.toContain('현금성자산')
    expect(expectedTotals.byCategory.get('예적금')?.get('2010-01')).toBe(2400)
    expect(expectedTotals.debt.get('2010-02')).toBe(5100)
  })

  it('turns the X column into a monthly note', () => {
    const { notes } = parseHoldingsSheet(holdingsSheet())
    expect(notes).toEqual([{ module: 'ASSET', ym: '2010-01', status: 'DONE', body: '결혼, 부동산매입' }])
  })
})

describe('crossCheck', () => {
  it('passes when our sums match the sheet totals', () => {
    const balances = parseBalanceSheet(balanceSheet())
    const holdings = parseHoldingsSheet(holdingsSheet())
    const { mismatches, comparedCategories } = crossCheck(balances.ownTotals, holdings.expectedTotals)

    // 현금성자산 and 예적금 are present on both sides and agree.
    expect(comparedCategories).toContain('현금성자산')
    expect(comparedCategories).toContain('예적금')
    expect(mismatches).toEqual([])
  })

  it('reports the category and month when a sum disagrees', () => {
    const balances = parseBalanceSheet(balanceSheet())
    const holdings = parseHoldingsSheet(holdingsSheet())
    holdings.expectedTotals.byCategory.get('예적금')!.set('2010-01', 9999)

    const { mismatches } = crossCheck(balances.ownTotals, holdings.expectedTotals)
    expect(mismatches).toHaveLength(1)
    expect(mismatches[0]).toMatchObject({ category: '예적금', ym: '2010-01', ours: 2400, sheet: 9999 })
  })

  it('matches category names case-insensitively so ficc meets FICC', () => {
    const ours = new Map([['FICC', new Map([['2010-01', 100]])]])
    const expected = { byCategory: new Map([['ficc', new Map([['2010-01', 100]])]]), debt: new Map() }
    const { mismatches, unmatchedSheetCategories } = crossCheck(ours, expected)
    expect(mismatches).toEqual([])
    expect(unmatchedSheetCategories).toEqual([])
  })

  it('names sheet categories it could not pair up', () => {
    const expected = { byCategory: new Map([['없는분류', new Map([['2010-01', 5]])]]), debt: new Map() }
    const { unmatchedSheetCategories } = crossCheck(new Map(), expected)
    expect(unmatchedSheetCategories).toEqual(['없는분류'])
  })
})

describe('combine', () => {
  it('gives debt items ids and folds their snapshots in', () => {
    const balances = parseBalanceSheet(balanceSheet())
    const holdings = parseHoldingsSheet(holdingsSheet())
    const merged = combine(balances, holdings)

    expect(merged.categories.at(-1)).toMatchObject({ name: '부채', kind: 'DEBT' })

    const mortgage = merged.items.find((i) => i.name === '주택담보대출')
    expect(mortgage).toBeDefined()
    expect(merged.snapshots.filter((s) => s.itemId === mortgage!.id)).toHaveLength(2)

    // Item ids stay unique across both sheets.
    expect(new Set(merged.items.map((i) => i.id)).size).toBe(merged.items.length)
    expect(merged.notes).toHaveLength(1)
  })
})
