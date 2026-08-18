import { useMemo, useState } from 'react'
import {
  avgPriceKrw,
  byOwner,
  compositionAt,
  costOf,
  dimensionKeys,
  indexToBase,
  owners,
  recentNavs,
  summariseNavs,
} from '../lib/data/portfolio'
import { formatAmount, formatCompactWon, formatPercent } from '../lib/data/format'
import { seriesColor, SLOT_COUNT } from '../lib/chart/palette'
import { fetchQuotes } from '../lib/quotes/client'
import { fxPairsFor, toYahooSymbol } from '../lib/quotes/symbol'
import { krwPerUnit, summariseValues, valueHolding, type Valued } from '../lib/quotes/valuation'
import { hasQuoteProxy } from '../config'
import type { CurrencyCode } from '../lib/data/model'
import type { Vault } from '../state/useVault'
import { Alert, Badge, Button, Card, Muted } from '../ui/primitives'
import { StatTile } from '../ui/chart/StatTile'
import { StackedBar, type Segment } from '../ui/chart/StackedBar'
import { TrendChart, type Series } from '../ui/chart/TrendChart'

const TREND_MONTHS = 60

export function Portfolio({ vault, onGoToImport }: { vault: Vault; onGoToImport: () => void }) {
  const { data } = vault
  const mask = data.settings.maskAmounts

  const [owner, setOwner] = useState<string | null>(null)
  const [dimension, setDimension] = useState<'style' | 'region'>('style')

  const [prices, setPrices] = useState<{
    asOf: string
    bySymbol: Map<string, number>
    rates: Map<CurrencyCode, number>
    failed: Map<string, string>
  } | null>(null)
  const [loadingPrices, setLoadingPrices] = useState(false)
  const [priceError, setPriceError] = useState<string | null>(null)

  /** Symbol per holding, resolved once so the table and the request agree. */
  const symbolOf = useMemo(() => {
    const map = new Map<string, { symbol: string; problem?: string }>()
    for (const holding of data.holdings) map.set(holding.id, toYahooSymbol(holding.ticker, holding.exchange))
    return map
  }, [data.holdings])

  async function loadPrices() {
    setPriceError(null)
    setLoadingPrices(true)
    try {
      const symbols = [...symbolOf.values()]
        .filter((entry) => !entry.problem && entry.symbol !== '')
        .map((entry) => entry.symbol)
      const pairs = fxPairsFor(data.holdings.map((holding) => holding.currency))
      const result = await fetchQuotes(symbols, pairs)

      setPrices({
        asOf: result.asOf,
        bySymbol: new Map([...result.quotes].map(([symbol, quote]) => [symbol, quote.price])),
        rates: result.rates,
        failed: result.failed,
      })
    } catch (cause) {
      setPriceError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoadingPrices(false)
    }
  }


  const summary = useMemo(() => summariseNavs(data.portfolioNavs), [data.portfolioNavs])
  const window = useMemo(() => recentNavs(data.portfolioNavs, TREND_MONTHS), [data.portfolioNavs])
  const ownerList = useMemo(() => owners(data.holdings), [data.holdings])
  const visible = useMemo(() => byOwner(data.holdings, owner), [data.holdings, owner])
  const composition = useMemo(() => compositionAt(visible, dimension), [visible, dimension])
  const byCurrency = useMemo(() => compositionAt(visible, 'currency'), [visible])

  /**
   * Valuation is derived, never stored — a saved market value would be stale the
   * moment the market moved, and the ledger is the thing that holds facts.
   */
  const valued = useMemo((): Valued[] => {
    return visible.map((holding) => {
      const entry = symbolOf.get(holding.id)
      const price =
        prices && entry && !entry.problem ? (prices.bySymbol.get(entry.symbol) ?? null) : null
      const rate = prices ? krwPerUnit(holding.currency, prices.rates) : null
      return valueHolding(holding, price, rate, costOf(holding))
    })
  }, [visible, prices, symbolOf])

  const totals = useMemo(() => summariseValues(valued), [valued])

  /**
   * Slots come from every holding, not the visible ones: filtering by owner must
   * not repaint the classifications that survive the filter.
   */
  const slotOf = useMemo(() => {
    const keys = dimensionKeys(data.holdings, dimension)
    return new Map(keys.map((key, index) => [key, index]))
  }, [data.holdings, dimension])

  const currencySlotOf = useMemo(() => {
    const keys = dimensionKeys(data.holdings, 'currency')
    return new Map(keys.map((key, index) => [key, index]))
  }, [data.holdings])

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
            title="현재 시세"
            action={
              prices && (
                <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                  {new Date(prices.asOf).toLocaleString('ko-KR')}
                </span>
              )
            }
          >
            <div className="space-y-3">
              {!hasQuoteProxy() ? (
                <Muted>
                  <strong>환경 설정</strong> 에 시세 프록시 주소를 입력하면 현재가와 평가금액을 불러올 수
                  있습니다. 아래 표는 그때까지 매입원가만 보여줍니다.
                </Muted>
              ) : (
                <>
                  <Muted>
                    <strong>주가는 해당 통화, 평가금액은 원화</strong>입니다 —{' '}
                    <code>평가금액 = 수량 × 주가 × 환율</code>. 환율은 프록시가 원/1단위로 정규화해서
                    줍니다.
                  </Muted>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button onClick={() => void loadPrices()} disabled={loadingPrices}>
                      {loadingPrices ? '불러오는 중…' : prices ? '다시 불러오기' : '시세 불러오기'}
                    </Button>
                    {prices &&
                      [...prices.rates].map(([currency, rate]) => (
                        <Badge key={currency} tone="neutral">
                          {currency} {rate.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원
                        </Badge>
                      ))}
                  </div>
                </>
              )}

              {priceError && <Alert tone="error">{priceError}</Alert>}

              {prices && totals.marketValueKrw > 0 && (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <StatTile label="평가금액" value={totals.marketValueKrw} mask={mask} />
                  <StatTile label="매입원가" value={totals.costKrw} mask={mask} />
                  <StatTile label="평가손익" value={totals.gainKrw} mask={mask} />
                  <StatTile label="수익률" value={totals.returnPct} kind="percent" mask={mask} />
                </div>
              )}

              {prices && totals.unvalued.length > 0 && (
                <Alert tone="warn">
                  다음 종목은 값을 구하지 못해 <strong>합계에서 빠졌습니다.</strong> 조용히 0으로
                  더하면 총액이 말없이 줄어듭니다:{' '}
                  {totals.unvalued
                    .map((row) => `${row.holding.name} (${row.problem ?? '원인 불명'})`)
                    .join(', ')}
                </Alert>
              )}

              {prices && prices.failed.size > 0 && (
                <Alert tone="warn">
                  프록시가 다음을 조회하지 못했습니다:{' '}
                  {[...prices.failed].map(([symbol, reason]) => `${symbol} — ${reason}`).join(', ')}
                </Alert>
              )}

              {[...symbolOf].some(([, entry]) => entry.problem) && (
                <Alert tone="warn">
                  티커를 심볼로 바꾸지 못한 종목이 있습니다. 잘못된 접미사는 다른 회사의 시세를 가져오므로
                  추측하지 않았습니다:{' '}
                  {data.holdings
                    .filter((holding) => symbolOf.get(holding.id)?.problem)
                    .map((holding) => `${holding.name} — ${symbolOf.get(holding.id)!.problem}`)
                    .join(', ')}
                </Alert>
              )}
            </div>
          </Card>

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
                <strong>매입원가 기준</strong>이고 모두 <strong>원화</strong>입니다 — 시트의 매입원가
                컬럼이 이미 환산된 값입니다. 현재 평가액과 종목별 수익률은 시세 연동이 붙는 다음
                단계에서 채웁니다.
              </Muted>

              <StackedBar
                segments={composition.slices.map((slice): Segment => {
                  const slot = slotOf.get(slice.key) ?? SLOT_COUNT
                  return {
                    key: slice.key,
                    name: slice.key,
                    share: slice.share,
                    amount: slice.cost,
                    slot,
                    color: seriesColor(slot),
                  }
                })}
                total={composition.total}
                mask={mask}
              />
            </div>
          </Card>

          <Card title="통화별">
            <div className="space-y-3">
              <Muted>
                거래소가 정하는 통화별 매입원가입니다. 금액은 원화로 환산된 값이라 그대로 더할 수
                있습니다.
              </Muted>
              <StackedBar
                segments={byCurrency.slices.map((slice): Segment => {
                  const slot = currencySlotOf.get(slice.key) ?? SLOT_COUNT
                  return {
                    key: slice.key,
                    name: slice.key,
                    share: slice.share,
                    amount: slice.cost,
                    slot,
                    color: seriesColor(slot),
                  }
                })}
                total={byCurrency.total}
                mask={mask}
              />
            </div>
          </Card>

          <Card title="종목 목록">
            <HoldingTable rows={valued} mask={mask} />
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

function HoldingTable({ rows, mask }: { rows: Valued[]; mask: boolean }) {
  const sorted = [...rows].sort(
    (a, b) => (b.marketValueKrw ?? b.costKrw) - (a.marketValueKrw ?? a.costKrw),
  )
  const anyValued = rows.some((row) => row.marketValueKrw !== null)

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm">
        <thead>
          <tr className="border-b" style={{ borderColor: 'var(--line)' }}>
            {[
              '종목',
              '계좌',
              '구분',
              '수량',
              '매입단가(원)',
              '매입원가(원)',
              ...(anyValued ? ['현재가', '평가금액(원)', '수익률'] : []),
            ].map((label, index) => (
              <th
                key={label}
                scope="col"
                className={`px-2 py-1.5 font-medium ${index >= 3 ? 'text-right' : 'text-left'}`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ holding, price, marketValueKrw, costKrw, returnPct, problem }) => (
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
              <td className="tnum px-2 py-1.5 text-right">
                {mask ? '****' : formatAmount(holding.quantity)}
              </td>
              <td className="tnum px-2 py-1.5 text-right">
                {/* The sheet records 단가 already converted to won, with yen
                    carrying 100×; the scale is what makes it readable. There is
                    no native-currency purchase price to show. */}
                {mask ? '****' : formatAmount(Math.round(avgPriceKrw(holding)))}
              </td>
              <td className="tnum px-2 py-1.5 text-right">
                {formatCompactWon(costKrw, { mask })}
              </td>

              {anyValued && (
                <>
                  <td className="tnum px-2 py-1.5 text-right">
                    {/* Price stays in its own currency — that is the number the
                        market quotes. */}
                    {price === null
                      ? '—'
                      : mask
                        ? '****'
                        : formatAmount(price, { currency: holding.currency, showSymbol: true })}
                  </td>
                  <td className="tnum px-2 py-1.5 text-right">
                    {marketValueKrw === null ? (
                      <span title={problem} style={{ color: 'var(--ink-muted)' }}>
                        —
                      </span>
                    ) : (
                      formatCompactWon(marketValueKrw, { mask })
                    )}
                  </td>
                  <td
                    className={`tnum px-2 py-1.5 text-right ${
                      returnPct === null || returnPct === 0
                        ? ''
                        : returnPct > 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {returnPct === null ? '—' : mask ? '****' : formatPercent(returnPct, 1)}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
