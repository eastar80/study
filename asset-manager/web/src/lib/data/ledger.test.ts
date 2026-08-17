import { describe, expect, it } from 'vitest'
import { availableYears, buildLedger, monthsOfYear, setCell } from './ledger'
import { emptyData, type AssetData, type Item, type Snapshot } from './model'

function data(): AssetData {
  const base = emptyData()
  return {
    ...base,
    categories: [
      { id: 'c1', kind: 'ASSET', name: '현금성자산', color: 'emerald', order: 1 },
      { id: 'c2', kind: 'DEBT', name: '마통', color: 'rose', order: 2 },
      { id: 'c3', kind: 'DEBT', name: '부채', color: 'amber', order: 3 },
    ],
    items: [
      { id: 'i1', categoryId: 'c1', name: '국민은행 보통예금', currency: 'KRW', hidden: false, order: 1 },
      { id: 'i2', categoryId: 'c1', name: '현금', currency: 'KRW', hidden: false, order: 2 },
      { id: 'i3', categoryId: 'c2', name: '신한은행 마통', currency: 'KRW', hidden: false, order: 1 },
      { id: 'i4', categoryId: 'c3', name: '주택담보대출', currency: 'KRW', hidden: false, order: 1, isLoan: true },
    ],
    snapshots: [
      { itemId: 'i1', ym: '2026-01', amount: 1000 },
      { itemId: 'i1', ym: '2026-02', amount: 1500, memo: '입금' },
      { itemId: 'i2', ym: '2026-01', amount: 500 },
      // Both debts are stored negative.
      { itemId: 'i3', ym: '2026-01', amount: -300 },
      { itemId: 'i4', ym: '2026-01', amount: -2000 },
      { itemId: 'i4', ym: '2026-02', amount: -1900 },
    ],
  }
}

function row(rows: ReturnType<typeof buildLedger>, id: string) {
  const found = rows.find((r) => r.id === id)
  if (!found) throw new Error(`row ${id} not found`)
  return found
}

/** Value of a row in a given month of 2026 (1-based). */
function at(rows: ReturnType<typeof buildLedger>, id: string, month: number) {
  return row(rows, id).cells[month - 1]!.value
}

describe('monthsOfYear', () => {
  it('produces twelve zero-padded keys', () => {
    const months = monthsOfYear(2026)
    expect(months).toHaveLength(12)
    expect(months[0]).toBe('2026-01')
    expect(months[11]).toBe('2026-12')
  })
})

describe('availableYears', () => {
  it('lists only years that hold a record, ascending', () => {
    const snapshots: Snapshot[] = [
      { itemId: 'i1', ym: '2015-03', amount: 1 },
      { itemId: 'i1', ym: '2010-01', amount: 1 },
      { itemId: 'i1', ym: '2015-04', amount: 1 },
    ]
    expect(availableYears(snapshots)).toEqual([2010, 2015])
    expect(availableYears([])).toEqual([])
  })
})

describe('buildLedger', () => {
  it('shows debts positive even though they are stored negative', () => {
    const rows = buildLedger(data(), 2026)
    expect(at(rows, 'i3', 1)).toBe(300)
    expect(at(rows, 'i4', 1)).toBe(2000)
  })

  it('sums each category into a subtotal', () => {
    const rows = buildLedger(data(), 2026)
    // 현금성자산 = 1000 + 500
    expect(at(rows, 's-c1', 1)).toBe(1500)
    // February only has 국민은행.
    expect(at(rows, 's-c1', 2)).toBe(1500)
  })

  it('counts 마통 as debt, not as an asset', () => {
    const rows = buildLedger(data(), 2026)
    // 마통 300 + 주택담보대출 2000
    expect(at(rows, 'total-debt', 1)).toBe(2300)
    // Assets exclude it.
    expect(at(rows, 'total-asset', 1)).toBe(1500)
  })

  it('computes net worth as assets minus debts', () => {
    const rows = buildLedger(data(), 2026)
    expect(at(rows, 'total-net', 1)).toBe(1500 - 2300)
    expect(at(rows, 'total-net', 2)).toBe(1500 - 1900)
  })

  it('leaves months with no record blank instead of zero', () => {
    const rows = buildLedger(data(), 2026)
    // Nothing was recorded in March.
    expect(at(rows, 'i1', 3)).toBeNull()
    expect(at(rows, 'total-asset', 3)).toBeNull()
    expect(at(rows, 'total-net', 3)).toBeNull()
    // 현금 has January only, so February is blank for that item...
    expect(at(rows, 'i2', 2)).toBeNull()
    // ...while the subtotal still reports the sibling that does have February.
    expect(at(rows, 's-c1', 2)).toBe(1500)
  })

  it('carries the cell memo and keeps it off aggregate rows', () => {
    const rows = buildLedger(data(), 2026)
    expect(row(rows, 'i1').cells[1]!.memo).toBe('입금')
    expect(row(rows, 's-c1').cells[1]!.memo).toBeNull()
  })

  it('omits hidden items unless asked, and drops their value from the subtotal', () => {
    const withHidden = data()
    withHidden.items = withHidden.items.map((item): Item =>
      item.id === 'i2' ? { ...item, hidden: true } : item,
    )

    const visible = buildLedger(withHidden, 2026)
    expect(visible.some((r) => r.id === 'i2')).toBe(false)
    expect(at(visible, 's-c1', 1)).toBe(1000)

    const all = buildLedger(withHidden, 2026, { showHidden: true })
    expect(all.some((r) => r.id === 'i2')).toBe(true)
    expect(at(all, 's-c1', 1)).toBe(1500)
  })

  it('folds a collapsed category to its group row, keeping the total intact', () => {
    const rows = buildLedger(data(), 2026, { collapsed: new Set(['c1']) })
    expect(rows.some((r) => r.id === 'i1')).toBe(false)
    expect(rows.some((r) => r.id === 's-c1')).toBe(false)
    // The group row still shows the sum, and the asset total is unaffected.
    expect(at(rows, 'g-c1', 1)).toBe(1500)
    expect(at(rows, 'total-asset', 1)).toBe(1500)
  })

  it('orders rows as group, items, subtotal, then the totals', () => {
    const kinds = buildLedger(data(), 2026).map((r) => `${r.kind}:${r.id}`)
    expect(kinds).toEqual([
      'group:g-c1',
      'item:i1',
      'item:i2',
      'subtotal:s-c1',
      'group:g-c2',
      'item:i3',
      'subtotal:s-c2',
      'group:g-c3',
      'item:i4',
      'subtotal:s-c3',
      'assetTotal:total-asset',
      'debtTotal:total-debt',
      'netWorth:total-net',
    ])
  })

  it('reports the change between the first and last month that have values', () => {
    const rows = buildLedger(data(), 2026)
    expect(row(rows, 'i1').yearChange).toBe(500)
    // A single month cannot show a change.
    expect(row(rows, 'i2').yearChange).toBeNull()
    // Debt fell, so in display sign the change is negative.
    expect(row(rows, 'i4').yearChange).toBe(-100)
  })

  it('keeps the row skeleton for a year with no records so it can be filled in', () => {
    const rows = buildLedger(data(), 1999)
    // The items still exist; they just have nothing recorded that year. Returning
    // an empty grid would leave no cells to type into.
    expect(rows.map((r) => r.id)).toContain('i1')
    expect(rows.every((r) => r.cells.every((c) => c.value === null))).toBe(true)
    expect(rows.every((r) => r.yearChange === null)).toBe(true)
  })

  it('skips categories that have no visible items', () => {
    const withEmpty = data()
    withEmpty.categories = [
      ...withEmpty.categories,
      { id: 'c9', kind: 'ASSET', name: '빈분류', color: 'sky', order: 9 },
    ]
    expect(buildLedger(withEmpty, 2026).some((r) => r.id === 'g-c9')).toBe(false)
  })
})

describe('setCell', () => {
  const asset: Item = { id: 'i1', categoryId: 'c1', name: 'a', currency: 'KRW', hidden: false, order: 1 }
  const debt: Item = { id: 'i4', categoryId: 'c3', name: 'd', currency: 'KRW', hidden: false, order: 1 }

  it('stores an asset as entered', () => {
    const next = setCell([], asset, false, '2026-03', 700, null)
    expect(next).toEqual([{ itemId: 'i1', ym: '2026-03', amount: 700 }])
  })

  it('stores a debt negative however it was entered', () => {
    expect(setCell([], debt, true, '2026-03', 500, null)[0]!.amount).toBe(-500)
    // A user typing the minus sign must not double-negate into a positive.
    expect(setCell([], debt, true, '2026-03', -500, null)[0]!.amount).toBe(-500)
  })

  it('replaces the existing record for that item and month only', () => {
    const existing: Snapshot[] = [
      { itemId: 'i1', ym: '2026-03', amount: 100 },
      { itemId: 'i1', ym: '2026-04', amount: 200 },
      { itemId: 'i4', ym: '2026-03', amount: -50 },
    ]
    const next = setCell(existing, asset, false, '2026-03', 999, null)
    expect(next).toHaveLength(3)
    expect(next.find((s) => s.itemId === 'i1' && s.ym === '2026-03')?.amount).toBe(999)
    expect(next.find((s) => s.itemId === 'i1' && s.ym === '2026-04')?.amount).toBe(200)
    expect(next.find((s) => s.itemId === 'i4' && s.ym === '2026-03')?.amount).toBe(-50)
  })

  it('removes the record when cleared rather than writing zero', () => {
    const existing: Snapshot[] = [{ itemId: 'i1', ym: '2026-03', amount: 100 }]
    expect(setCell(existing, asset, false, '2026-03', null, null)).toEqual([])
  })

  it('keeps a memo and drops an empty one', () => {
    expect(setCell([], asset, false, '2026-03', 1, '메모')[0]!.memo).toBe('메모')
    expect(setCell([], asset, false, '2026-03', 1, '')[0]!.memo).toBeUndefined()
  })
})
