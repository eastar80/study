import { formatAmount, formatCompactWon, formatPercent } from '../../lib/data/format'
import type { Change } from '../../lib/data/dashboard'

/**
 * One KPI.
 *
 * For won, the compact figure leads because a nine-digit number is unreadable at
 * headline size, and the exact amount sits under it so nothing is only
 * approximate.
 *
 * `upIsGood` exists because the direction of "better" is not a property of the
 * number: 총부채 rising is bad, 총자산 rising is good, and colouring both green
 * for "up" would be actively misleading.
 */
export function StatTile({
  label,
  value,
  change,
  hero = false,
  upIsGood = true,
  mask = false,
  kind = 'won',
}: {
  label: string
  value: number | null
  change?: Change | null
  hero?: boolean
  upIsGood?: boolean
  mask?: boolean
  kind?: 'won' | 'percent'
}) {
  const good =
    change === null || change === undefined || change.delta === 0 ? null : change.delta > 0 === upIsGood

  const headline =
    value === null
      ? '—'
      : kind === 'percent'
        ? // One decimal: a leverage ratio rounded to whole percent hides a real move.
          formatPercent(value, 1).replace('+', '')
        : formatCompactWon(value, { mask })

  return (
    <div
      className="rounded-xl border px-4 py-3.5"
      style={{ borderColor: 'var(--line)', background: 'var(--card)' }}
    >
      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </p>

      {/* Proportional figures, not tabular: equal-width digits make a large
          standalone number look loose. */}
      <p className={`mt-1 font-semibold tracking-tight ${hero ? 'text-[40px] leading-[1.1]' : 'text-2xl'}`}>
        {mask && kind === 'percent' ? '****' : headline}
      </p>

      {value !== null && kind === 'won' && (
        <p className="tnum mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {formatAmount(value, { mask })}원
        </p>
      )}

      {change && (
        <p className="mt-2 text-xs">
          <span
            className={
              good === null
                ? ''
                : good
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
            }
          >
            {kind === 'percent'
              ? // A change in a percentage is percentage points, and two decimals
                // so a small move does not collapse to "0%".
                `${formatPercent(change.delta, 2)}p`
              : `${change.delta > 0 ? '+' : change.delta < 0 ? '−' : ''}${formatCompactWon(
                  Math.abs(change.delta),
                  { mask },
                )}${change.percent === null ? '' : ` (${formatPercent(change.percent)})`}`}
          </span>{' '}
          <span style={{ color: 'var(--ink-muted)' }}>{change.fromYm} 대비</span>
        </p>
      )}
    </div>
  )
}
