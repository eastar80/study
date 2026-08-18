import { useMemo, useState } from 'react'
import { formatAmount, formatCompactWon, monthLabel, shortYearMonth } from '../../lib/data/format'
import { linearScale, niceTicks } from '../../lib/chart/scale'
import { useElementWidth } from '../useElementWidth'

export interface Series {
  key: string
  label: string
  color: string
  values: (number | null)[]
}

const PAD = { top: 12, right: 76, bottom: 26, left: 60 }
const PLOT_HEIGHT = 200

/**
 * A multi-series line chart over months.
 *
 * One y-axis, always: assets, debts and net worth are all won, so they belong on
 * a shared scale. Two scales on one plot would invent a correlation that isn't in
 * the data.
 *
 * The hover layer is not an extra — a chart you cannot interrogate makes the
 * reader guess at the values between the labelled ends. Every value it reveals is
 * also in the table view, so nothing is reachable only by hovering.
 */
export function TrendChart({
  months,
  series,
  notes = {},
  mask = false,
  formatValue = (value) => formatCompactWon(value),
  formatExact,
  includeZero = true,
}: {
  months: string[]
  series: Series[]
  /** ym → event note, drawn as a tick under the axis and shown on hover. */
  notes?: Record<string, string>
  mask?: boolean
  /** Axis and label formatting, for a chart whose values are not won. */
  formatValue?: (value: number | null) => string
  /** Tooltip formatting, when the exact figure reads differently to the axis. */
  formatExact?: (value: number) => string
  /**
   * Stretch the axis to zero. Right for money, wrong for an indexed series —
   * those are anchored at 100, and a zero baseline squashes the whole story into
   * the top third of the plot.
   */
  includeZero?: boolean
}) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)

  const ticks = useMemo(() => {
    const values = series.flatMap((one) => one.values.filter((value): value is number => value !== null))
    if (values.length === 0) return [0, 1]
    return niceTicks(Math.min(...values), Math.max(...values), { includeZero })
  }, [series, includeZero])

  const scale = useMemo(() => linearScale(ticks), [ticks])

  const exact = (value: number, masked: boolean) =>
    masked ? '****' : formatExact ? formatExact(value) : `${formatAmount(value)}원`

  const height = PAD.top + PLOT_HEIGHT + PAD.bottom
  const plotWidth = Math.max(0, width - PAD.left - PAD.right)

  // Labels need roughly this much room each; drawing more than fit smears them
  // into an unreadable band, which is what sixty months did.
  const LABEL_WIDTH = 34
  const longSpan = months.length > 12
  const stride = Math.max(
    1,
    Math.ceil(months.length / Math.max(1, Math.floor(plotWidth / LABEL_WIDTH))),
  )


  // A single month has no width to spread over, so it sits in the middle.
  const xOf = (index: number) =>
    PAD.left + (months.length <= 1 ? plotWidth / 2 : (plotWidth * index) / (months.length - 1))
  const yOf = (value: number) => PAD.top + PLOT_HEIGHT * (1 - scale(value))

  function onMove(event: React.PointerEvent<SVGSVGElement>) {
    if (months.length === 0 || plotWidth <= 0) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - bounds.left - PAD.left
    const ratio = plotWidth === 0 ? 0 : x / plotWidth
    const index = Math.round(ratio * Math.max(1, months.length - 1))
    setActive(Math.min(months.length - 1, Math.max(0, index)))
  }

  if (months.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
        추이를 그릴 기록이 없습니다.
      </p>
    )
  }

  const activeYm = active === null ? null : months[active]!

  return (
    <div>
      {/* Legend: three series, so identity never rests on colour-matching alone. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {series.map((one) => (
          <span key={one.key} className="flex items-center gap-1.5 text-xs">
            <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: one.color }} />
            {one.label}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setShowTable((value) => !value)}
          className="ml-auto rounded border px-2 py-0.5 text-xs"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-muted)' }}
          aria-expanded={showTable}
        >
          {showTable ? '표 닫기' : '표로 보기'}
        </button>
      </div>

      <div ref={wrapRef} className="w-full">
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`${months[0]}부터 ${months.at(-1)}까지 ${series.map((one) => one.label).join(', ')} 추이`}
            onPointerMove={onMove}
            onPointerLeave={() => setActive(null)}
            style={{ touchAction: 'pan-y' }}
          >
            {/* Gridlines: solid hairlines one step off the surface. Dashes would
                read as a threshold when this is only a grid. */}
            {ticks.map((tick) => {
              const y = yOf(tick)
              const isZero = tick === 0
              return (
                <g key={tick}>
                  <line
                    x1={PAD.left}
                    x2={PAD.left + plotWidth}
                    y1={y}
                    y2={y}
                    stroke={isZero ? 'var(--ink-muted)' : 'var(--line)'}
                    strokeWidth={1}
                    opacity={isZero ? 0.45 : 1}
                  />
                  <text
                    x={PAD.left - 8}
                    y={y + 3.5}
                    textAnchor="end"
                    className="tnum"
                    fontSize={10}
                    fill="var(--ink-muted)"
                  >
                    {mask ? '****' : formatValue(tick)}
                  </text>
                </g>
              )
            })}

            {months.map((ym, index) => {
              if (index % stride !== 0 && index !== months.length - 1) return null
              return (
                <text
                  key={ym}
                  x={xOf(index)}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--ink-muted)"
                >
                  {longSpan ? shortYearMonth(ym) : monthLabel(ym)}
                </text>
              )
            })}

            {/* Event notes from the workbook's X column: the months that explain
                an inflection. */}
            {months.map((ym, index) =>
              notes[ym] ? (
                <line
                  key={`note-${ym}`}
                  x1={xOf(index)}
                  x2={xOf(index)}
                  y1={PAD.top + PLOT_HEIGHT + 2}
                  y2={PAD.top + PLOT_HEIGHT + 7}
                  stroke="var(--ink-muted)"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              ) : null,
            )}

            {active !== null && (
              <line
                x1={xOf(active)}
                x2={xOf(active)}
                y1={PAD.top}
                y2={PAD.top + PLOT_HEIGHT}
                stroke="var(--ink-muted)"
                strokeWidth={1}
              />
            )}

            {series.map((one) => {
              const points = one.values
                .map((value, index) => (value === null ? null : ([xOf(index), yOf(value)] as const)))
                .filter((point): point is readonly [number, number] => point !== null)
              if (points.length === 0) return null

              return (
                <g key={one.key}>
                  <polyline
                    points={points.map(([x, y]) => `${x},${y}`).join(' ')}
                    fill="none"
                    stroke={one.color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* End dot with a surface ring, so it stays legible where lines
                      cross. */}
                  <circle
                    cx={points.at(-1)![0]}
                    cy={points.at(-1)![1]}
                    r={4}
                    fill={one.color}
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                  {/* Direct end-label, supplementing the legend. */}
                  <text
                    x={points.at(-1)![0] + 10}
                    y={points.at(-1)![1] + 3.5}
                    fontSize={11}
                    fill="var(--ink)"
                  >
                    {mask ? '****' : formatValue(one.values.at(-1) ?? null)}
                  </text>
                </g>
              )
            })}

            {active !== null &&
              series.map((one) => {
                const value = one.values[active]
                if (value === null || value === undefined) return null
                return (
                  <circle
                    key={`dot-${one.key}`}
                    cx={xOf(active)}
                    cy={yOf(value)}
                    r={4}
                    fill={one.color}
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                )
              })}
          </svg>
        )}
      </div>

      {/* The tooltip sits outside the SVG so it can wrap text and never clips. */}
      <div className="mt-2 min-h-[3.25rem] text-xs">
        {activeYm ? (
          <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)' }}>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="font-medium">{activeYm}</span>
              {series.map((one) => (
                <span key={one.key} className="flex items-center gap-1.5">
                  <span aria-hidden className="size-2 rounded-sm" style={{ background: one.color }} />
                  {one.label}{' '}
                  <span className="tnum">
                    {one.values[active!] === null || one.values[active!] === undefined
                      ? '기록 없음'
                      : exact(one.values[active!]!, mask)}
                  </span>
                </span>
              ))}
            </div>
            {notes[activeYm] && (
              <p className="mt-1.5" style={{ color: 'var(--ink-muted)' }}>
                {notes[activeYm]}
              </p>
            )}
          </div>
        ) : (
          <p style={{ color: 'var(--ink-muted)' }}>
            그래프 위에 커서를 두면 그 달의 값을 볼 수 있습니다. 축 아래 짧은 눈금은 이벤트 메모가 있는
            달입니다.
          </p>
        )}
      </div>

      {showTable && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--line)' }}>
                <th scope="col" className="px-2 py-1.5 text-left font-medium">
                  월
                </th>
                {series.map((one) => (
                  <th key={one.key} scope="col" className="px-2 py-1.5 text-right font-medium">
                    {one.label}
                  </th>
                ))}
                <th scope="col" className="px-2 py-1.5 text-left font-medium">
                  이벤트
                </th>
              </tr>
            </thead>
            <tbody>
              {months.map((ym, index) => (
                <tr key={ym} className="border-b" style={{ borderColor: 'var(--line)' }}>
                  <th scope="row" className="px-2 py-1.5 text-left font-normal">
                    {ym}
                  </th>
                  {series.map((one) => (
                    <td key={one.key} className="tnum px-2 py-1.5 text-right">
                      {one.values[index] === null || one.values[index] === undefined
                        ? ''
                        : exact(one.values[index]!, mask)}
                    </td>
                  ))}
                  <td className="px-2 py-1.5" style={{ color: 'var(--ink-muted)' }}>
                    {notes[ym] ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
