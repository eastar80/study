import { formatAmount, formatCompactWon, formatShare } from '../../lib/data/format'
import type { CurrencyCode } from '../../lib/data/model'

export interface Segment {
  key: string
  name: string
  /** 0–1. Shares across all segments sum to 1. */
  share: number
  amount: number
  color: string
  /** Position in the palette, so the bar can be drawn in slot order. */
  slot: number
}

/**
 * A part-to-whole bar with its legend.
 *
 * The legend is not optional decoration: three of the light-mode hues fall below
 * 3:1 against the card, so the label and the amount beside each swatch are what
 * make the chart readable. Segments are separated by a 2px gap in the surface
 * colour rather than by a border — a stroke would add ink that isn't data.
 *
 * Labels never go inside the segments. At eight categories the small ones cannot
 * fit text, and a clipped label is worse than none.
 */
export function StackedBar({
  segments,
  total,
  mask = false,
  emptyMessage = '기록이 없습니다.',
  currency = 'KRW',
}: {
  segments: Segment[]
  total: number
  mask?: boolean
  emptyMessage?: string
  /** 억/만 is a won reading, so a dollar or yen bar must not wear it. */
  currency?: CurrencyCode
}) {
  if (segments.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
        {emptyMessage}
      </p>
    )
  }

  /**
   * The bar is drawn in palette-slot order while the legend stays sorted by size.
   *
   * Two reasons the bar cannot follow the legend's order. The palette's
   * colourblind separation is validated for *adjacent slots*, and reordering by
   * amount puts arbitrary pairs next to each other — including yellow beside
   * orange, which is the one pair that fails. And a bar whose segments reshuffle
   * as amounts change is unreadable across months.
   */
  const drawn = [...segments].sort((a, b) => a.slot - b.slot)

  return (
    <div>
      <div className="flex h-5 w-full gap-0.5 overflow-hidden" role="presentation">
        {drawn.map((segment, index) => (
          <div
            key={segment.key}
            // A tiny holding still gets a visible sliver; its value is in the
            // legend, so the sliver only has to say "this exists".
            style={{
              flexGrow: Math.max(segment.share, 0.0001),
              flexBasis: 0,
              minWidth: 2,
              background: segment.color,
              borderRadius: index === drawn.length - 1 ? '0 4px 4px 0' : 0,
            }}
            title={`${segment.name} ${money(segment.amount, currency, mask)}`}
          />
        ))}
      </div>

      <ul className="mt-3 grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-baseline gap-2 text-sm">
            <span
              aria-hidden
              className="mt-1.5 size-2.5 shrink-0 rounded-sm"
              style={{ background: segment.color }}
            />
            <span className="min-w-0 flex-1 truncate">{segment.name}</span>
            <span className="tnum shrink-0" style={{ color: 'var(--ink-muted)' }}>
              {formatShare(segment.share)}
            </span>
            <span className="tnum shrink-0 tabular-nums">{money(segment.amount, currency, mask)}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 border-t pt-2 text-sm" style={{ borderColor: 'var(--line)' }}>
        합계 <span className="tnum font-medium">{money(total, currency, mask, true)}</span>
      </p>
    </div>
  )
}

/**
 * Won gets the 억/만 reading it would be spoken with; other currencies get their
 * own symbol and plain digits, because "3,240만" of dollars is not a thing.
 */
function money(value: number, currency: CurrencyCode, mask: boolean, exact = false): string {
  if (mask) return '****'
  if (currency === 'KRW') {
    return exact ? `${formatAmount(value)}원` : formatCompactWon(value)
  }
  return formatAmount(value, { currency, showSymbol: true })
}
