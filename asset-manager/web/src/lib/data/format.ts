import type { CurrencyCode } from './model'

const FORMATTERS = new Map<string, Intl.NumberFormat>()

function formatter(fractionDigits: number): Intl.NumberFormat {
  const cacheKey = String(fractionDigits)
  let found = FORMATTERS.get(cacheKey)
  if (!found) {
    found = new Intl.NumberFormat('ko-KR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: fractionDigits,
    })
    FORMATTERS.set(cacheKey, found)
  }
  return found
}

const SYMBOLS: Partial<Record<CurrencyCode, string>> = {
  KRW: '₩',
  USD: '$',
  JPY: '¥',
  EUR: '€',
  GBP: '£',
  CNY: '¥',
}

export interface AmountOptions {
  /** Replace the digits with asterisks, for screen sharing. */
  mask?: boolean
  currency?: CurrencyCode
  showSymbol?: boolean
}

/**
 * Formats a ledger amount. A null value renders as an empty string, which is how
 * "nothing recorded" is distinguished from a zero balance.
 */
export function formatAmount(value: number | null, options: AmountOptions = {}): string {
  if (value === null) return ''
  if (options.mask) return '****'

  const currency = options.currency ?? 'KRW'
  // Won amounts are whole; foreign holdings carry cents.
  const digits = currency === 'KRW' || currency === 'JPY' ? 0 : 2
  const text = formatter(digits).format(value)

  return options.showSymbol ? `${SYMBOLS[currency] ?? ''}${text}` : text
}

/** Signed change, with an explicit plus so direction reads at a glance. */
export function formatChange(value: number | null, options: AmountOptions = {}): string {
  if (value === null) return ''
  if (options.mask) return '****'
  const text = formatAmount(Math.abs(value), { ...options, mask: false })
  if (value === 0) return text
  return `${value > 0 ? '+' : '−'}${text}`
}

export function formatRate(rate: number | null): string {
  if (rate === null) return ''
  return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(rate)}%`
}

/** '2026-01' → '1월' for a compact column header. */
export function monthLabel(ym: string): string {
  return `${Number(ym.slice(5, 7))}월`
}

/** Parses a typed amount, tolerating thousands separators and a stray sign. */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[,\s₩$¥€£]/g, '').trim()
  if (cleaned === '' || cleaned === '-') return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}
