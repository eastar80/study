/**
 * Source-data corrections and the suggestions the cross-check derives from a
 * mismatch list.
 *
 * A mismatch that the user can do nothing about makes the cross-check a dead
 * end, so this turns "these months disagree by a constant" into a rule that can
 * be registered, kept, and removed.
 */

import type { ImportAdjustment, YearMonth } from '../data/model'
import type { Mismatch } from './assetWorkbook'

/** Whether an adjustment covers this column and month. Bounds are inclusive. */
export function appliesTo(adjustment: ImportAdjustment, sourceKey: string, ym: YearMonth): boolean {
  if (adjustment.sourceKey !== sourceKey) return false
  if (adjustment.fromYm && ym < adjustment.fromYm) return false
  if (adjustment.toYm && ym > adjustment.toYm) return false
  return true
}

/** Total delta for a cell — several rules may overlap on the same column. */
export function deltaFor(
  adjustments: readonly ImportAdjustment[],
  sheet: ImportAdjustment['sheet'],
  sourceKey: string,
  ym: YearMonth,
): number {
  let total = 0
  for (const adjustment of adjustments) {
    if (adjustment.sheet === sheet && appliesTo(adjustment, sourceKey, ym)) total += adjustment.delta
  }
  return total
}

function monthIndex(ym: YearMonth): number {
  return Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1
}

export interface AdjustmentSuggestion {
  category: string
  /** What to add to make our sum match the sheet — the negation of the diff. */
  delta: number
  fromYm: YearMonth
  toYm: YearMonth
  monthCount: number
}

export interface SuggestionResult {
  suggestions: AdjustmentSuggestion[]
  /** Categories a single rule cannot cover, with the reason. */
  rejected: { category: string; reason: string }[]
}

/**
 * Groups mismatches by category and proposes one rule per category, but only
 * where a single rule genuinely covers the difference: the diff must be constant
 * and the months contiguous.
 *
 * Proposing a rule for an uneven difference would fix the months it happens to
 * match and quietly break the rest.
 */
export function suggestFromMismatches(mismatches: readonly Mismatch[], tolerance = 1): SuggestionResult {
  const byCategory = new Map<string, Mismatch[]>()
  for (const mismatch of mismatches) {
    const list = byCategory.get(mismatch.category) ?? []
    list.push(mismatch)
    byCategory.set(mismatch.category, list)
  }

  const suggestions: AdjustmentSuggestion[] = []
  const rejected: { category: string; reason: string }[] = []

  for (const [category, list] of byCategory) {
    const sorted = [...list].sort((a, b) => a.ym.localeCompare(b.ym))
    const first = sorted[0]!
    const diffs = sorted.map((mismatch) => mismatch.diff)

    const spread = Math.max(...diffs) - Math.min(...diffs)
    if (spread > tolerance) {
      rejected.push({
        category,
        reason: `차이가 월마다 다릅니다 (${Math.round(Math.min(...diffs)).toLocaleString('ko-KR')} ~ ${Math.round(Math.max(...diffs)).toLocaleString('ko-KR')}). 규칙 하나로 덮을 수 없습니다.`,
      })
      continue
    }

    const last = sorted[sorted.length - 1]!
    const span = monthIndex(last.ym) - monthIndex(first.ym) + 1
    if (span !== sorted.length) {
      rejected.push({
        category,
        reason: `${first.ym} ~ ${last.ym} 사이에 일치하는 달이 섞여 있습니다 (${sorted.length}/${span}개월). 연속 구간이 아니라 규칙 하나로 덮을 수 없습니다.`,
      })
      continue
    }

    suggestions.push({
      category,
      // diff is ours − sheet, so the correction is its negation.
      delta: -first.diff,
      fromYm: first.ym,
      toYm: last.ym,
      monthCount: sorted.length,
    })
  }

  suggestions.sort((a, b) => a.category.localeCompare(b.category))
  return { suggestions, rejected }
}

const won = new Intl.NumberFormat('ko-KR')

export function describeAdjustment(adjustment: ImportAdjustment): string {
  const range =
    adjustment.fromYm && adjustment.toYm
      ? `${adjustment.fromYm} ~ ${adjustment.toYm}`
      : adjustment.fromYm
        ? `${adjustment.fromYm} 이후`
        : adjustment.toYm
          ? `${adjustment.toYm} 까지`
          : '전체 기간'

  const sign = adjustment.delta < 0 ? '−' : '+'
  const sheet = adjustment.sheet === 'BALANCE' ? '잔액입력' : '자산보유현황'
  return `${sheet} ${adjustment.sourceKey}열 · ${range} · ${sign}${won.format(Math.abs(adjustment.delta))}원`
}

/** Stable identity for list keys and removal, since rules carry no id. */
export function adjustmentKey(adjustment: ImportAdjustment): string {
  return [adjustment.sheet, adjustment.sourceKey, adjustment.fromYm ?? '', adjustment.toYm ?? '', adjustment.delta].join(
    '|',
  )
}
