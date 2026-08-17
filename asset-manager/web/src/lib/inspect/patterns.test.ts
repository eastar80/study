import { describe, expect, it } from 'vitest'
import type { CellData } from '../google/sheets'
import {
  backgroundKey,
  classifyCell,
  detectTicker,
  integerDigits,
  leadingIndent,
  parseMonthToken,
} from './patterns'

describe('parseMonthToken', () => {
  it('reads the spellings hand-made Korean sheets use', () => {
    const cases: [string, string][] = [
      ['2026-07', '2026-07'],
      ['2026-7', '2026-07'],
      ['2026/07', '2026-07'],
      ['2026.07', '2026-07'],
      ['2026. 07', '2026-07'],
      ['2026년 7월', '2026-07'],
      ['2026년07월', '2026-07'],
      ['202607', '2026-07'],
      ['2026-07-01', '2026-07'],
      ['2026.07.31', '2026-07'],
      ["'26/07", '2026-07'],
      ['26-07', '2026-07'],
      ['07/2026', '2026-07'],
    ]
    for (const [input, expected] of cases) {
      expect(parseMonthToken(input)?.ym, input).toBe(expected)
    }
  })

  it('expands two-digit years around the 1970 pivot', () => {
    expect(parseMonthToken('26/01')?.ym).toBe('2026-01')
    expect(parseMonthToken('99/01')?.ym).toBe('1999-01')
  })

  it('reports a month with no year instead of inventing one', () => {
    expect(parseMonthToken('7월')).toEqual({ ym: null, month: 7 })
    expect(parseMonthToken('07월')).toEqual({ ym: null, month: 7 })
  })

  it('rejects out-of-range months and unrelated text', () => {
    expect(parseMonthToken('2026-13')).toBeNull()
    expect(parseMonthToken('13월')).toBeNull()
    expect(parseMonthToken('주택담보대출')).toBeNull()
    expect(parseMonthToken('')).toBeNull()
    expect(parseMonthToken(null)).toBeNull()
    // A bare balance must never be mistaken for a month.
    expect(parseMonthToken('230000000')).toBeNull()
  })
})

function cell(partial: Partial<CellData>): CellData {
  return partial as CellData
}

describe('classifyCell', () => {
  it('reads the currency from the number format', () => {
    expect(
      classifyCell(
        cell({
          formattedValue: '₩12,000,000',
          effectiveValue: { numberValue: 12_000_000 },
          effectiveFormat: { numberFormat: { type: 'CURRENCY', pattern: '₩#,##0' } },
        }),
      ),
    ).toEqual({ kind: 'currency', currency: 'KRW' })

    expect(
      classifyCell(
        cell({
          formattedValue: '$12,340.55',
          effectiveValue: { numberValue: 12_340.55 },
          effectiveFormat: { numberFormat: { type: 'CURRENCY', pattern: '"$"#,##0.00' } },
        }),
      ),
    ).toEqual({ kind: 'currency', currency: 'USD' })
  })

  it('falls back to the rendered text when a sheet carries no format', () => {
    expect(
      classifyCell(cell({ formattedValue: '$1,200', effectiveValue: { numberValue: 1200 } })),
    ).toEqual({ kind: 'currency', currency: 'USD' })
    expect(
      classifyCell(cell({ formattedValue: '3.45%', effectiveValue: { numberValue: 0.0345 } })),
    ).toEqual({ kind: 'percent' })
  })

  it('separates rates from balances', () => {
    expect(
      classifyCell(
        cell({
          formattedValue: '3.45%',
          effectiveValue: { numberValue: 0.0345 },
          effectiveFormat: { numberFormat: { type: 'PERCENT', pattern: '0.00%' } },
        }),
      ).kind,
    ).toBe('percent')
  })

  it('treats a blank cell as empty rather than text', () => {
    expect(classifyCell(cell({}))).toEqual({ kind: 'empty' })
    expect(classifyCell(cell({ formattedValue: '   ' })).kind).toBe('empty')
    expect(classifyCell(undefined)).toEqual({ kind: 'empty' })
  })

  it('keeps plain labels as text', () => {
    expect(classifyCell(cell({ formattedValue: '주택청약저축', effectiveValue: { stringValue: '주택청약저축' } }))).toEqual(
      { kind: 'text' },
    )
  })
})

describe('detectTicker', () => {
  it('tells KRX codes from foreign tickers', () => {
    expect(detectTicker('069500')).toBe('krx')
    expect(detectTicker("'447770")).toBe('krx')
    expect(detectTicker('TSLA')).toBe('foreign')
    expect(detectTicker('BRK.B')).toBe('foreign')
  })

  it('rejects names and mixed text', () => {
    expect(detectTicker('KODEX AI반도체TOP2플러스')).toBeNull()
    expect(detectTicker('12345')).toBeNull()
    expect(detectTicker('1234567')).toBeNull()
    expect(detectTicker('')).toBeNull()
  })
})

describe('leadingIndent', () => {
  it('measures the hierarchy hand-made sheets express with spaces', () => {
    expect(leadingIndent('주택청약저축')).toBe(0)
    expect(leadingIndent('  주택청약저축')).toBe(2)
    expect(leadingIndent('   현금')).toBe(3)
  })
})

describe('backgroundKey', () => {
  it('ignores white and unset so only real group colours count', () => {
    expect(backgroundKey(undefined)).toBeNull()
    expect(backgroundKey({ backgroundColor: { red: 1, green: 1, blue: 1 } })).toBeNull()
    expect(backgroundKey({ backgroundColor: { red: 1, green: 0.8, blue: 0.4 } })).toBe('255,204,102')
  })
})

describe('integerDigits', () => {
  it('distinguishes a rate from a balance by magnitude', () => {
    expect(integerDigits(3.45)).toBe(1)
    expect(integerDigits(-230_000_000)).toBe(9)
    expect(integerDigits(0.05)).toBe(1)
  })
})
