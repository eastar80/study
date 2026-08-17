/**
 * Chart colour assignment.
 *
 * The hex values live in `index.css` as `--series-1` … `--series-8`, not here,
 * so light and dark swap without any JavaScript knowing which mode is active.
 * This module owns the *mapping* — which entity gets which slot.
 *
 * The slot ordering is a validated colourblind-safety mechanism: adjacent pairs
 * clear a CVD ΔE of 8 and a normal-vision ΔE of 15 against the app's card
 * surfaces (#ffffff / #1c1f27) in both modes, checked with the palette
 * validator. Two consequences to respect:
 *
 *   - Assign slots in order. A ninth entity folds into 기타 rather than getting a
 *     generated hue, which would be indistinguishable from an existing slot.
 *   - Three light-mode hues sit below 3:1 against white, so every chart here
 *     ships a legend carrying the label and the amount. Colour is never the only
 *     way to read a value.
 */

export const SLOT_COUNT = 8

export const OTHER_LABEL = '기타'

/** A CSS colour reference, so the theme decides the actual value. */
export type SeriesColor = string

export function seriesColor(slot: number): SeriesColor {
  return slot >= 0 && slot < SLOT_COUNT ? `var(--series-${slot + 1})` : 'var(--series-other)'
}

/**
 * Assigns slots to ids in a fixed order.
 *
 * Built from the *complete* list of ids, never from whatever a filter left
 * behind. If slots were assigned by position in the visible set, changing the
 * month would repaint the categories that happened to survive, and a reader who
 * learned "주식및투자 is blue" would be misled.
 */
export function slotAssignment(ids: readonly string[]): Map<string, SeriesColor> {
  return new Map(ids.map((id, index) => [id, seriesColor(index)]))
}
