import { describe, expect, it } from 'vitest'
import { emptyData, normaliseData } from './model'

describe('normaliseData', () => {
  it('fills in a field the stored payload predates', () => {
    // The real failure: the IndexedDB cache was written before
    // `importAdjustments` existed, so reading it raw put `undefined` where the
    // import screen expected an array. The app painted once from `emptyData()`
    // and blanked as soon as the cache landed.
    const legacy = { ...emptyData() } as Record<string, unknown>
    delete legacy.importAdjustments

    expect(normaliseData(legacy).importAdjustments).toEqual([])
  })

  it('never leaves a collection undefined, whatever is missing', () => {
    // Enumerated from emptyData() rather than written out, so a field added
    // later without a normaliseData branch fails here instead of blanking the
    // screen on someone's device.
    const collections = Object.entries(emptyData())
      .filter(([, value]) => Array.isArray(value))
      .map(([key]) => key)
    expect(collections.length).toBeGreaterThan(0)

    for (const omitted of collections) {
      const partial = { ...emptyData() } as Record<string, unknown>
      delete partial[omitted]

      const result = normaliseData(partial) as unknown as Record<string, unknown>
      for (const key of collections) {
        expect(Array.isArray(result[key]), `${key} after dropping ${omitted}`).toBe(true)
      }
    }
  })

  it('replaces a wrong type rather than passing it through', () => {
    const corrupt = { ...emptyData(), items: 'not an array', snapshots: null }
    const result = normaliseData(corrupt)
    expect(result.items).toEqual([])
    expect(result.snapshots).toEqual([])
  })

  it('keeps known settings and defaults the rest', () => {
    const result = normaliseData({ settings: { maskAmounts: true } })
    expect(result.settings.maskAmounts).toBe(true)
    expect(result.settings.baseCurrency).toBe('KRW')
  })

  it('returns the empty shape for anything that is not an object', () => {
    expect(normaliseData(null)).toEqual(emptyData())
    expect(normaliseData('{}')).toEqual(emptyData())
    expect(normaliseData(undefined)).toEqual(emptyData())
  })
})
