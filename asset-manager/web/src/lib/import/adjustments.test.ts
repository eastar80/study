import { describe, expect, it } from 'vitest'
import type { ImportAdjustment } from '../data/model'
import { adjustmentKey, appliesTo, deltaFor, describeAdjustment, suggestFromMismatches } from './adjustments'
import type { Mismatch } from './assetWorkbook'

function rule(partial: Partial<ImportAdjustment> = {}): ImportAdjustment {
  return {
    sourceKey: 'M',
    sheet: 'BALANCE',
    delta: -16_700_000,
    reason: '무가치 채권이 액면가로 남아 있음',
    ...partial,
  }
}

describe('appliesTo', () => {
  it('treats both bounds as inclusive', () => {
    const adjustment = rule({ fromYm: '2018-09', toYm: '2026-07' })
    expect(appliesTo(adjustment, 'M', '2018-09')).toBe(true)
    expect(appliesTo(adjustment, 'M', '2026-07')).toBe(true)
    expect(appliesTo(adjustment, 'M', '2018-08')).toBe(false)
    expect(appliesTo(adjustment, 'M', '2026-08')).toBe(false)
  })

  it('leaves other columns alone', () => {
    const adjustment = rule({ fromYm: '2018-09', toYm: '2026-07' })
    expect(appliesTo(adjustment, 'L', '2020-01')).toBe(false)
    expect(appliesTo(adjustment, 'N', '2020-01')).toBe(false)
  })

  it('supports open-ended ranges', () => {
    expect(appliesTo(rule({ fromYm: '2018-09' }), 'M', '2030-01')).toBe(true)
    expect(appliesTo(rule({ fromYm: '2018-09' }), 'M', '2010-01')).toBe(false)
    expect(appliesTo(rule({ toYm: '2018-09' }), 'M', '2010-01')).toBe(true)
    expect(appliesTo(rule({}), 'M', '1999-01')).toBe(true)
  })
})

describe('deltaFor', () => {
  it('ignores rules meant for the other sheet', () => {
    const rules = [rule({ sheet: 'HOLDINGS' })]
    expect(deltaFor(rules, 'BALANCE', 'M', '2020-01')).toBe(0)
    expect(deltaFor(rules, 'HOLDINGS', 'M', '2020-01')).toBe(-16_700_000)
  })

  it('adds up overlapping rules on the same column', () => {
    const rules = [rule({ delta: -1000 }), rule({ delta: -500, fromYm: '2020-01' })]
    expect(deltaFor(rules, 'BALANCE', 'M', '2019-12')).toBe(-1000)
    expect(deltaFor(rules, 'BALANCE', 'M', '2020-01')).toBe(-1500)
  })

  it('is zero when nothing matches', () => {
    expect(deltaFor([], 'BALANCE', 'M', '2020-01')).toBe(0)
  })
})

function mismatch(ym: string, diff: number, category = 'ficc'): Mismatch {
  return { category, ym, ours: 100 + diff, sheet: 100, diff }
}

describe('suggestFromMismatches', () => {
  it('proposes one rule for a constant difference over a contiguous range', () => {
    // The real case: 2018-09 through 2026-07, every month off by the same amount.
    const months: Mismatch[] = []
    for (let year = 2018, month = 9; !(year === 2026 && month === 8); ) {
      months.push(mismatch(`${year}-${String(month).padStart(2, '0')}`, 16_700_000))
      month += 1
      if (month > 12) {
        month = 1
        year += 1
      }
    }
    expect(months).toHaveLength(95)

    const { suggestions, rejected } = suggestFromMismatches(months)
    expect(rejected).toEqual([])
    expect(suggestions).toEqual([
      {
        category: 'ficc',
        // The correction is the negation of the diff.
        delta: -16_700_000,
        fromYm: '2018-09',
        toYm: '2026-07',
        monthCount: 95,
      },
    ])
  })

  it('refuses when the difference varies month to month', () => {
    const { suggestions, rejected } = suggestFromMismatches([
      mismatch('2020-01', 1000),
      mismatch('2020-02', 2000),
    ])
    // Covering an uneven difference with one rule would fix one month and break
    // the other.
    expect(suggestions).toEqual([])
    expect(rejected).toHaveLength(1)
    expect(rejected[0]!.category).toBe('ficc')
    expect(rejected[0]!.reason).toContain('월마다 다릅니다')
  })

  it('refuses when matching months are interleaved with the mismatched ones', () => {
    const { suggestions, rejected } = suggestFromMismatches([
      mismatch('2020-01', 1000),
      // 2020-02 agreed, so it is absent from the list.
      mismatch('2020-03', 1000),
    ])
    expect(suggestions).toEqual([])
    expect(rejected[0]!.reason).toContain('연속 구간이 아니라')
  })

  it('tolerates rounding within the allowed difference', () => {
    const { suggestions } = suggestFromMismatches([
      mismatch('2020-01', 1000),
      mismatch('2020-02', 1000.4),
    ])
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]!.monthCount).toBe(2)
  })

  it('handles each category separately', () => {
    const { suggestions, rejected } = suggestFromMismatches([
      mismatch('2020-01', 1000, 'ficc'),
      mismatch('2020-02', 1000, 'ficc'),
      mismatch('2020-01', 500, '연금'),
      mismatch('2020-02', 900, '연금'),
    ])
    expect(suggestions.map((s) => s.category)).toEqual(['ficc'])
    expect(rejected.map((r) => r.category)).toEqual(['연금'])
  })

  it('accepts a single month', () => {
    const { suggestions } = suggestFromMismatches([mismatch('2020-01', 1000)])
    expect(suggestions[0]).toMatchObject({ fromYm: '2020-01', toYm: '2020-01', monthCount: 1 })
  })

  it('returns nothing for an empty list', () => {
    expect(suggestFromMismatches([])).toEqual({ suggestions: [], rejected: [] })
  })
})

describe('describeAdjustment', () => {
  it('names the sheet, column, range and signed amount', () => {
    expect(describeAdjustment(rule({ fromYm: '2018-09', toYm: '2026-07' }))).toBe(
      '잔액입력 M열 · 2018-09 ~ 2026-07 · −16,700,000원',
    )
    expect(describeAdjustment(rule({ sheet: 'HOLDINGS', delta: 500, fromYm: '2020-01' }))).toBe(
      '자산보유현황 M열 · 2020-01 이후 · +500원',
    )
    expect(describeAdjustment(rule({ toYm: '2020-01' }))).toContain('2020-01 까지')
    expect(describeAdjustment(rule({}))).toContain('전체 기간')
  })
})

describe('adjustmentKey', () => {
  it('separates rules that differ in any field', () => {
    const base = rule({ fromYm: '2018-09' })
    expect(adjustmentKey(base)).toBe(adjustmentKey({ ...base, reason: '다른 사유' }))
    expect(adjustmentKey(base)).not.toBe(adjustmentKey({ ...base, delta: -1 }))
    expect(adjustmentKey(base)).not.toBe(adjustmentKey({ ...base, sourceKey: 'N' }))
    expect(adjustmentKey(base)).not.toBe(adjustmentKey({ ...base, sheet: 'HOLDINGS' }))
  })
})
