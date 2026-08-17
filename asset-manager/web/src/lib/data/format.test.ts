import { describe, expect, it } from 'vitest'
import { formatCompactWon, formatPercent } from './format'

describe('formatCompactWon', () => {
  it('says 억 the way the amount would be spoken', () => {
    expect(formatCompactWon(677_000_000)).toBe('6.8억')
    expect(formatCompactWon(100_000_000)).toBe('1억')
  })

  it('drops the decimal past 100억, where it is only noise', () => {
    expect(formatCompactWon(12_345_000_000)).toBe('123억')
  })

  it('falls back to 만, then to plain won', () => {
    expect(formatCompactWon(34_500_000)).toBe('3,450만')
    expect(formatCompactWon(10_000)).toBe('1만')
    expect(formatCompactWon(9_999)).toBe('9,999')
    expect(formatCompactWon(0)).toBe('0')
  })

  it('uses a real minus sign, not a hyphen', () => {
    expect(formatCompactWon(-120_000_000)).toBe('−1.2억')
  })

  it('masks and treats null as nothing recorded', () => {
    expect(formatCompactWon(677_000_000, { mask: true })).toBe('****')
    expect(formatCompactWon(null)).toBe('')
  })
})

describe('formatPercent', () => {
  it('signs the direction explicitly', () => {
    expect(formatPercent(12.34)).toBe('+12.3%')
    expect(formatPercent(-4)).toBe('−4%')
  })

  it('leaves zero unsigned', () => {
    expect(formatPercent(0)).toBe('0%')
  })

  it('renders null as empty rather than as zero', () => {
    // "0%" would claim no change; null means there was nothing to compare.
    expect(formatPercent(null)).toBe('')
  })
})
