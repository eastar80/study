import { describe, expect, it } from 'vitest'
import { fxPairsFor, toYahooSymbol } from './symbol'

describe('toYahooSymbol', () => {
  it('suffixes a KRX code', () => {
    expect(toYahooSymbol('069500', 'KRX')).toEqual({ symbol: '069500.KS' })
  })

  it('uses the kosdaq suffix, which is a different market', () => {
    expect(toYahooSymbol('086520', 'kosdaq')).toEqual({ symbol: '086520.KQ' })
  })

  it('suffixes a Tokyo code', () => {
    expect(toYahooSymbol('8058', 'JPX')).toEqual({ symbol: '8058.T' })
  })

  it('leaves a US symbol bare and uppercases it', () => {
    expect(toYahooSymbol('TSLA', 'USD')).toEqual({ symbol: 'TSLA' })
    expect(toYahooSymbol('ief', 'USD')).toEqual({ symbol: 'IEF' })
    expect(toYahooSymbol('O', 'USD')).toEqual({ symbol: 'O' })
  })

  it('drops the venue prefix Google adds', () => {
    expect(toYahooSymbol('BATS: ECH', 'USD')).toEqual({ symbol: 'ECH' })
    expect(toYahooSymbol('NasdaqGs:hsai', 'USD')).toEqual({ symbol: 'HSAI' })
  })

  it('does not append a second suffix to a symbol that has one', () => {
    // `8001.T` is already a Yahoo symbol; `8001.T.T` resolves to nothing.
    expect(toYahooSymbol('8001.T', 'JPX')).toEqual({ symbol: '8001.T' })
  })

  it('says so when the ticker is empty rather than asking for nothing', () => {
    expect(toYahooSymbol('', 'KRX').problem).toContain('비어')
    expect(toYahooSymbol('   ', 'KRX').problem).toContain('비어')
  })

  it('names an exchange it does not know instead of guessing a suffix', () => {
    // A wrong suffix returns a different company's price, which is worse than
    // returning nothing.
    const result = toYahooSymbol('ABC', 'XETRA')
    expect(result.symbol).toBe('ABC')
    expect(result.problem).toContain('XETRA')
  })

  it('treats an unlabelled exchange as carrying no suffix', () => {
    expect(toYahooSymbol('AAPL', '')).toEqual({ symbol: 'AAPL' })
  })
})

describe('fxPairsFor', () => {
  it('asks for each foreign currency once', () => {
    expect(fxPairsFor(['KRW', 'USD', 'JPY', 'USD'])).toEqual(['JPYKRW', 'USDKRW'])
  })

  it('asks for nothing when everything is won', () => {
    expect(fxPairsFor(['KRW', 'KRW'])).toEqual([])
  })
})
