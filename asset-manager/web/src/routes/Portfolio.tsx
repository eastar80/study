import { useMemo, useState } from 'react'
import {
  byOwner,
  compositionByCurrency,
  costOf,
  dimensionKeys,
  indexToBase,
  owners,
  recentNavs,
  summariseNavs,
} from '../lib/data/portfolio'
import { formatAmount, formatCompactWon, formatPercent } from '../lib/data/format'
import { seriesColor, SLOT_COUNT } from '../lib/chart/palette'
import type { CurrencyCode, Holding } from '../lib/data/model'
import type { Vault } from '../state/useVault'
import { Button, Card, Muted } from '../ui/primitives'
import { StatTile } from '../ui/chart/StatTile'
import { StackedBar, type Segment } from '../ui/chart/StackedBar'
import { TrendChart, type Series } from '../ui/chart/TrendChart'

const TREND_MONTHS = 60

const SYMBOL: Partial<Record<CurrencyCode, string>> = { KRW: '₩', USD: '$', JPY: '¥' }

export function Portfolio({ vault, onGoToImport }: { vault: Vault; onGoToImport: () => void }) {
  const { data } = vault
  const mask = data.settings.maskAmounts

  const [owner, setOwner] = useState<string | null>(null)
  const [dimension, setDimension] = useState<'style' | 'region'>('style')

  const summary = useMemo(() => summariseNavs(data.portfolioNavs), [data.portfolioNavs])
  const window = useMemo(() => recentNavs(data.portfolioNavs, TREND_MONTHS), [data.portfolioNavs])
  const ownerList = useMemo(() => owners(data.holdings), [data.holdings])
  const visible = useMemo(() => byOwner(data.holdings, owner), [data.holdings, owner])
  const groups = useMemo(() => compositionByCurrency(visible, dimension), [visible, dimension])

  /**
   * Slots come from every holding, not the visible ones: filtering by owner must
   * not repaint the classifications that survive the filter.
   */
  const slotOf = useMemo(() => {
    const keys = dimensionKeys(data.holdings, dimension)
    return new Map(keys.map((key, index) => [key, index]))
  }, [data.holdings, dimension])

  const series: Series[] = useMemo(() => {
    const fund = indexToBase(window.map((month) => month.nav))
    const benchmark = indexToBase(window.map((month) => month.benchmark))
    const hasBenchmark = benchmark.some((value) => value !== null)
    return [
      { key: 'nav', label: '기준가', color: seriesColor(0), values: fund },
      ...(hasBenchmark
        ? [{ key: 'kospi', label: 'KOSPI', color: seriesColor(1), values: benchmark }]
        : []),
    ]
  }, [window])

  if (data.portfolioNavs.length === 0 && data.holdings.length === 0) {
    return (
      <Card title="포트폴리오">
        <div className="space-y-4">
          <Muted>
            아직 증권 데이터가 없습니다. 가져오기에서 <strong>자산운용수익률</strong> 파일을 선택하면
            기준가 추이와 보유 종목이 채워집니다.
          </Muted>
          <Button onClick={onGoToImport}>가져오기로 이동</Button>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      {/* One filter row above everything it scopes. */}
      {ownerList.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            계좌주
          </span>
          <FilterChip active={owner === null} onClick={() => setOwner(null)}>
            전체
          </FilterChip>
          {ownerList.map((name) => (
            <FilterChip key={name} active={owner === name} onClick={() => setOwner(name)}>
              {name}
            </FilterChip>
          ))}
        </div>
      )}

      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label={`평가금액 (${summary.ym})`} value={summary.marketValue} hero mask={mask} />
          <StatTile label="누적 입금" value={summary.cumulativeIn} mask={mask} />
          <StatTile label="누적 수익" value={summary.cumulativeProfit} mask={mask} />
          <StatTile label="수익률 (기준가)" value={summary.returnPct} kind="percent" mask={mask} />
        </div>
      )}

      {summary && summary.benchmarkReturnPct !== null && (
        <Card title="KOSPI 대비">
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 text-sm">
            <span>
              내 포트폴리오{' '}
              <strong className="text-base">{mask ? '****' : formatPercent(summary.returnPct, 1)}</strong>
            </span>
            <span>
              KOSPI{' '}
              <strong className="text-base">
                {mask ? '****' : formatPercent(summary.benchmarkReturnPct, 1)}
              </strong>
            </span>
            <span
              className={
                summary.excessPct === null || summary.excessPct === 0
                  ? ''
                  : summary.excessPct > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
              }
            >
              초과 수익{' '}
              <strong className="text-base">
                {mask ? '****' : `${formatPercent(summary.excessPct, 1)}p`}
              </strong>
            </span>
          </div>
          <Muted>
            수익률은 <strong>기준가</strong> 로 계산합니다. 기준가는 성과로만 움직이는 단위 가격이라
            입금 시점에 좌우되지 않습니다.
          </Muted>
        </Card>
      )}

      {window.length > 0 && (
        <Card
          title={`기준가 추이 (최근 ${window.length}개월)`}
          action={
            <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              {window[0]?.ym} ~ {window.at(-1)?.ym}
            </span>
          }
        >
          <div className="space-y-3">
            <Muted>
              기준가는 1000, KOSPI는 수천에서 출발해 그대로 겹치면 축이 두 개 필요해집니다. 두 축의
              정렬은 임의여서 데이터에 없는 상관관계를 만들어내므로,{' '}
              <strong>둘 다 시작을 100으로 맞춰</strong> 한 축에 그렸습니다.
            </Muted>
            <TrendChart
              months={window.map((month) => month.ym)}
              series={series}
              mask={mask}
              formatValue={(value) =>
                value === null ? '' : new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(value)
              }
              formatExact={(value) => `${value.toFixed(1)} (${formatPercent(value - 100, 1)})`}
              includeZero={false}
            />
          </div>
        </Card>
      )}

      {data.holdings.length > 0 && (
        <>
          <Card
            title={`보유 종목 ${visible.length}개`}
            action={
              <div className="flex gap-1">
                <FilterChip active={dimension === 'style'} onClick={() => setDimension('style')}>
                  구분
                </FilterChip>
                <FilterChip active={dimension === 'region'} onClick={() => setDimension('region')}>
                  지역
                </FilterChip>
              </div>
            }
          >
            <div className="space-y-5">
              <Muted>
                매입원가 기준입니다. 현재 평가액과 종목별 수익률은 시세 연동이 붙는 다음 단계에서
                채웁니다.
              </Muted>

              {groups.map((group) => (
                <div key={group.currency}>
                  {groups.length > 1 && (
                    <p className="mb-2 text-sm font-medium">
                      {group.currency}{' '}
                      <span className="tnum font-normal" style={{ color: 'var(--ink-muted)' }}>
                        {mask ? '****' : `${SYMBOL[group.currency] ?? ''}${formatAmount(group.total)}`}
                      </span>
                    </p>
                  )}
                  <StackedBar
                    segments={group.slices.map((slice): Segment => {
                      const slot = slotOf.get(slice.key) ?? SLOT_COUNT
                      return {
                        key: `${group.currency}-${slice.key}`,
                        name: slice.key,
                        share: slice.share,
                        amount: slice.cost,
                        slot,
                        color: seriesColor(slot),
                      }
                    })}
                    total={group.total}
                    mask={mask}
                    currency={group.currency}
                  />
                </div>
              ))}

              {groups.length > 1 && (
                <Muted>
                  통화가 다른 금액은 더하지 않았습니다. 환율이 아직 없어서, 합치려면 없는 숫자를
                  지어내야 합니다. 시세 연동과 함께 채웁니다.
                </Muted>
              )}
            </div>
          </Card>

          <Card title="종목 목록">
            <HoldingTable holdings={visible} mask={mask} />
          </Card>
        </>
      )}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md border px-2.5 py-1 text-xs ${active ? 'font-medium' : ''}`}
      style={{
        borderColor: active ? 'transparent' : 'var(--line)',
        background: active ? 'var(--surface)' : 'transparent',
      }}
    >
      {children}
    </button>
  )
}

function HoldingTable({ holdings, mask }: { holdings: Holding[]; mask: boolean }) {
  const sorted = [...holdings].sort((a, b) => costOf(b) - costOf(a))

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b" style={{ borderColor: 'var(--line)' }}>
            {['종목', '계좌', '구분', '지역', '수량', '평균단가', '매입원가'].map((label, index) => (
              <th
                key={label}
                scope="col"
                className={`px-2 py-1.5 font-medium ${index >= 4 ? 'text-right' : 'text-left'}`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((holding) => (
            <tr key={holding.id} className="border-b" style={{ borderColor: 'var(--line)' }}>
              <th scope="row" className="px-2 py-1.5 text-left font-normal">
                {holding.name}
                {holding.currency !== 'KRW' && (
                  <span className="ml-1.5 text-[10px] opacity-60">{holding.currency}</span>
                )}
              </th>
              <td className="px-2 py-1.5" style={{ color: 'var(--ink-muted)' }}>
                {holding.account}
              </td>
              <td className="px-2 py-1.5">{holding.style}</td>
              <td className="px-2 py-1.5">{holding.region}</td>
              <td className="tnum px-2 py-1.5 text-right">
                {mask ? '****' : formatAmount(holding.quantity)}
              </td>
              <td className="tnum px-2 py-1.5 text-right">
                {mask ? '****' : formatAmount(holding.avgPrice, { currency: holding.currency })}
              </td>
              <td className="tnum px-2 py-1.5 text-right">
                {/* 억/만 is a won reading; a dollar cost must not wear it. */}
                {mask
                  ? '****'
                  : holding.currency === 'KRW'
                    ? formatCompactWon(costOf(holding))
                    : formatAmount(costOf(holding), { currency: holding.currency, showSymbol: true })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
