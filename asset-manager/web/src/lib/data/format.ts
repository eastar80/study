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

/**
 * Compact won for headline figures: `6.8억`, `3,450만`, `-1.2억`.
 *
 * At the scale this ledger holds, a nine-digit figure is unreadable as a
 * headline. 억/만 is how the amount would be said out loud, so it is what the
 * KPI cards show — with the exact figure beside it, never instead of it.
 */
export function formatCompactWon(value: number | null, options: AmountOptions = {}): string {
  if (value === null) return ''
  if (options.mask) return '****'

  const sign = value < 0 ? '−' : ''
  const abs = Math.abs(value)

  if (abs >= 100_000_000) {
    const 억 = abs / 100_000_000
    // One decimal up to 100억, none beyond — "1,234.5억" is noise.
    const digits = 억 >= 100 ? 0 : 1
    return `${sign}${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: digits }).format(억)}억`
  }
  if (abs >= 10_000) {
    return `${sign}${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(abs / 10_000)}만`
  }
  return `${sign}${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(abs)}`
}

/** An unsigned share of a whole, from a 0–1 fraction. */
export function formatShare(fraction: number): string {
  return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(fraction * 100)}%`
}

/** Signed percent for a KPI delta. Null renders empty, not `0%`. */
export function formatPercent(value: number | null, digits = 1): string {
  if (value === null) return ''
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: digits }).format(Math.abs(value))}%`
}

export function formatRate(rate: number | null): string {
  if (rate === null) return ''
  return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(rate)}%`
}

/** '2026-01' → '26.1', for an axis spanning years where '1월' is ambiguous. */
export function shortYearMonth(ym: string): string {
  return `${ym.slice(2, 4)}.${Number(ym.slice(5, 7))}`
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
