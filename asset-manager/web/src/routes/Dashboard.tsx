import { useMemo, useState } from 'react'
import {
  changeAgainstPrevious,
  monthlyTotals,
  summariseMonth,
  trailingMonths,
  type CategorySlice,
} from '../lib/data/dashboard'
import { formatAmount } from '../lib/data/format'
import { SLOT_COUNT, seriesColor } from '../lib/chart/palette'
import type { Vault } from '../state/useVault'
import { Alert, Button, Card, Muted } from '../ui/primitives'
import { StatTile } from '../ui/chart/StatTile'
import { StackedBar, type Segment } from '../ui/chart/StackedBar'
import { TrendChart, type Series } from '../ui/chart/TrendChart'

const TREND_MONTHS = 12

export function Dashboard({ vault, onGoToImport }: { vault: Vault; onGoToImport: () => void }) {
  const { data } = vault
  const mask = data.settings.maskAmounts

  const totals = useMemo(() => monthlyTotals(data), [data])
  const [ym, setYm] = useState<string | null>(null)

  // Follow the latest month as data arrives, until the user picks one.
  const activeYm = ym ?? totals.at(-1)?.ym ?? null

  const summary = useMemo(
    () => (activeYm ? summariseMonth(data, activeYm) : null),
    [data, activeYm],
  )

  /**
   * Slots are assigned from the full category list rather than from the ones that
   * happen to have a value this month — otherwise changing the month would
   * repaint whichever categories survived, and a reader who learned "실물자산 is
   * pink" would be misled.
   *
   * Assets and debts get separate sequences because they are separate charts with
   * separate legends. Sharing one sequence pushed the debt categories past the
   * eighth slot and painted the main debt bar 기타 grey.
   */
  const slots = useMemo(() => {
    const ordered = [...data.categories].sort((a, b) => a.order - b.order)
    const index = new Map<string, number>()
    for (const kind of ['ASSET', 'DEBT'] as const) {
      ordered
        .filter((category) => category.kind === kind)
        .forEach((category, position) => index.set(category.id, position))
    }
    return index
  }, [data.categories])

  const window = useMemo(
    () => (activeYm ? trailingMonths(totals, activeYm, TREND_MONTHS) : []),
    [totals, activeYm],
  )

  const noteByYm = useMemo(() => {
    const map: Record<string, string> = {}
    for (const note of data.notes) if (note.body) map[note.ym] = note.body
    return map
  }, [data.notes])

  const series: Series[] = useMemo(
    () => [
      { key: 'net', label: '순자산', color: seriesColor(0), values: window.map((m) => m.net) },
      { key: 'asset', label: '총자산', color: seriesColor(1), values: window.map((m) => m.asset) },
      { key: 'debt', label: '총부채', color: seriesColor(2), values: window.map((m) => m.debt) },
    ],
    [window],
  )

  if (totals.length === 0) {
    return (
      <Card title="대시보드">
        <div className="space-y-4">
          <Muted>
            아직 기록이 없습니다. 대시보드의 모든 숫자는 자산 대장에서 집계되므로, 먼저 스프레드시트를
            가져오거나 자산 관리에서 직접 입력해 주세요.
          </Muted>
          <Button onClick={onGoToImport}>가져오기로 이동</Button>
        </div>
      </Card>
    )
  }

  const netChange = activeYm ? changeAgainstPrevious(totals, activeYm, (m) => m.net) : null
  const assetChange = activeYm ? changeAgainstPrevious(totals, activeYm, (m) => m.asset) : null
  const debtChange = activeYm ? changeAgainstPrevious(totals, activeYm, (m) => m.debt) : null
  const leverageChange = activeYm
    ? changeAgainstPrevious(totals, activeYm, (m) => (m.asset === 0 ? 0 : (m.debt / m.asset) * 100))
    : null

  return (
    <div className="space-y-5">
      {/* One filter row above everything it scopes, rather than a control per card. */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span style={{ color: 'var(--ink-muted)' }}>기준월</span>
          <select
            value={activeYm ?? ''}
            onChange={(event) => setYm(event.target.value)}
            className="rounded-md border bg-[var(--card)] px-2 py-1 text-sm"
            style={{ borderColor: 'var(--line)' }}
          >
            {[...totals].reverse().map((month) => (
              <option key={month.ym} value={month.ym}>
                {month.ym}
              </option>
            ))}
          </select>
        </label>

        {activeYm !== totals.at(-1)?.ym && (
          <Button variant="ghost" onClick={() => setYm(null)}>
            최신 월로
          </Button>
        )}

        <label className="ml-auto flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={mask}
            onChange={(event) =>
              vault.update((draft) => ({
                ...draft,
                settings: { ...draft.settings, maskAmounts: event.target.checked },
              }))
            }
          />
          금액 가리기
        </label>
      </div>

      {summary === null ? (
        <Alert tone="warn">{activeYm} 에는 기록이 없습니다.</Alert>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="순자산" value={summary.net} change={netChange} hero mask={mask} />
            <StatTile label="총자산" value={summary.asset} change={assetChange} mask={mask} />
            <StatTile
              label="총부채"
              value={summary.debt}
              change={debtChange}
              upIsGood={false}
              mask={mask}
            />
            <StatTile
              label="레버리지 비율"
              value={summary.leverage}
              change={leverageChange}
              upIsGood={false}
              kind="percent"
              mask={mask}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card title="자산 구성">
              <StackedBar
                segments={toSegments(summary.assets, slots)}
                total={summary.asset}
                mask={mask}
                emptyMessage={`${summary.ym} 에 기록된 자산이 없습니다.`}
              />
            </Card>

            <Card title="부채 구성">
              <div className="space-y-3">
                <StackedBar
                  segments={toSegments(summary.debts, slots)}
                  total={summary.debt}
                  mask={mask}
                  emptyMessage={`${summary.ym} 에 기록된 부채가 없습니다.`}
                />

                {summary.excluded.length > 0 && (
                  <div
                    className="rounded-lg border px-3 py-2 text-sm"
                    style={{ borderColor: 'var(--line)' }}
                  >
                    <p style={{ color: 'var(--ink-muted)' }}>
                      아래 항목은 다른 항목에 이미 포함되어 있어 <strong>합계에 넣지 않았습니다.</strong>
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {summary.excluded.map((entry) => (
                        <li key={entry.itemId} className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate">
                            {entry.name}{' '}
                            <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                              {entry.reason}
                            </span>
                          </span>
                          <span className="tnum shrink-0">
                            {mask ? '****' : `${entry.amount < 0 ? '−' : ''}${formatAmount(Math.abs(entry.amount))}원`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {summary.debtOffsets.length > 0 && (
                  <div
                    className="rounded-lg border px-3 py-2 text-sm"
                    style={{ borderColor: 'var(--line)' }}
                  >
                    <p style={{ color: 'var(--ink-muted)' }}>
                      아래 계좌는 이 달에 빚이 아니라 돈을 들고 있었습니다. 부채의 구성이 아니라{' '}
                      <strong>차감</strong>이므로 막대에 넣지 않았습니다.
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {summary.debtOffsets.map((slice) => (
                        <li key={slice.categoryId} className="flex items-baseline justify-between gap-3">
                          <span>{slice.name}</span>
                          {/* One figure, one minus sign. Intl's hyphen next to
                              the compact form's − read as two different things. */}
                          <span className="tnum">
                            {mask ? '****' : `−${formatAmount(Math.abs(slice.amount))}원`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
          </div>

          <Card
            title={`최근 ${window.length}개월 추이`}
            action={
              <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                {window[0]?.ym} ~ {window.at(-1)?.ym}
              </span>
            }
          >
            <TrendChart
              months={window.map((month) => month.ym)}
              series={series}
              notes={noteByYm}
              mask={mask}
            />
          </Card>
        </>
      )}
    </div>
  )
}

function toSegments(slices: CategorySlice[], slots: Map<string, number>): Segment[] {
  return slices.map((slice) => {
    const slot = slots.get(slice.categoryId) ?? SLOT_COUNT
    return {
      key: slice.categoryId,
      name: slice.name,
      share: slice.share,
      amount: slice.amount,
      slot,
      color: seriesColor(slot),
    }
  })
}
