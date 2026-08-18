import { useMemo, useState } from 'react'
import { describeUnsupportedFile, pickSpreadsheet, type PickedFile } from '../lib/google/picker'
import { getSpreadsheetOutline, type Sheet } from '../lib/google/sheets'
import {
  SheetShapeError,
  parseHoldingsInput,
  parseNavSheet,
  type HoldingMismatch,
  type PriceScale,
  type NavMismatch,
} from '../lib/import/portfolioWorkbook'
import { compositionAt } from '../lib/data/portfolio'
import type { Vault } from '../state/useVault'
import { Alert, Badge, Button, Card, Muted } from '../ui/primitives'
import { SectionTitle, Stat, readSheet, won } from './importShared'

const NAV_SHEET = '기준가(월)'
const HOLDINGS_SHEET = '입력정보'

interface LoadedSheets {
  file: PickedFile
  nav: Sheet
  holdings: Sheet
}

/**
 * The securities workbook: monthly performance and current positions.
 *
 * Separate from the asset workbook flow rather than folded into it — the two
 * files share nothing but the picker, and either can be imported on its own.
 */
export function ImportSecurities({
  vault,
  signedIn,
  ready,
}: {
  vault: Vault
  signedIn: boolean
  ready: boolean
}) {
  const [sheets, setSheets] = useState<LoadedSheets | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imported, setImported] = useState(false)

  const preview = useMemo(() => {
    if (!sheets) return null
    try {
      const navs = parseNavSheet(sheets.nav, NAV_SHEET)
      const holdings = parseHoldingsInput(sheets.holdings, HOLDINGS_SHEET)
      return { navs, holdings, error: null as string | null }
    } catch (cause) {
      return {
        navs: null,
        holdings: null,
        error: cause instanceof SheetShapeError ? cause.message : String(cause),
      }
    }
  }, [sheets])

  async function load() {
    setError(null)
    setSheets(null)
    setImported(false)
    try {
      const file = await pickSpreadsheet()
      if (!file) return

      const unsupported = describeUnsupportedFile(file)
      if (unsupported) {
        setError(unsupported)
        return
      }

      setProgress('시트 목록 확인 중…')
      const outline = await getSpreadsheetOutline(file.id)
      const titles = (outline.sheets ?? []).map((s) => s.properties.title)

      const missing = [NAV_SHEET, HOLDINGS_SHEET].filter((title) => !titles.includes(title))
      if (missing.length > 0) {
        setError(
          `이 파일에 ${missing.map((m) => `"${m}"`).join(', ')} 시트가 없습니다. 자산운용수익률 파일을 골랐는지 확인해 주세요.`,
        )
        return
      }

      setProgress(`"${NAV_SHEET}" 읽는 중…`)
      const nav = await readSheet(file.id, NAV_SHEET)
      setProgress(`"${HOLDINGS_SHEET}" 읽는 중…`)
      const holdings = await readSheet(file.id, HOLDINGS_SHEET)

      setSheets({ file, nav, holdings })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setProgress(null)
    }
  }

  function apply() {
    if (!preview?.navs || !preview.holdings) return
    vault.update((draft) => ({
      ...draft,
      portfolioNavs: preview.navs!.navs,
      holdings: preview.holdings!.holdings,
    }))
    setImported(true)
  }

  const navMismatches = preview?.navs?.mismatches ?? []
  const costMismatches = preview?.holdings?.mismatches ?? []
  const passes = preview?.navs != null && navMismatches.length === 0 && costMismatches.length === 0

  const currencies = useMemo(
    () =>
      preview?.holdings
        ? compositionAt(preview.holdings.holdings, 'currency').slices.map((slice) => slice.key)
        : [],
    [preview],
  )

  return (
    <div className="space-y-5">
      <Card title="자산운용수익률 워크북 가져오기">
        <div className="space-y-4">
          <Muted>
            <strong>{NAV_SHEET}</strong> 에서 월별 성과를, <strong>{HOLDINGS_SHEET}</strong> 에서 보유
            종목을 가져옵니다. 수익률·누적입금·누적수익은 <strong>가져오지 않고</strong> 원본 값으로
            계산합니다 — 같은 사실을 두 번 저장하면 두 벌이 어긋날 수 있습니다. 대신 시트가 계산해 둔
            그 값들을 <strong>제 계산과 대조하는 데 씁니다.</strong>
          </Muted>

          {!ready && (
            <Alert tone="warn">
              먼저 <strong>환경 설정</strong>에서 클라이언트 ID와 API 키를 입력하세요.
            </Alert>
          )}

          {ready && signedIn && (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={load} disabled={progress !== null}>
                {progress ? '읽는 중…' : sheets ? '다시 읽기' : '자산운용수익률 파일 선택'}
              </Button>
              {sheets && <Badge tone="brand">{sheets.file.name}</Badge>}
            </div>
          )}

          {progress && <Muted>{progress}</Muted>}
          {error && <Alert tone="error">{error}</Alert>}
          {preview?.error && <Alert tone="error">{preview.error}</Alert>}
        </div>
      </Card>

      {preview?.navs && preview.holdings && (
        <>
          <Card title="가져올 내용">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
              <Stat
                label="기간"
                value={
                  preview.navs.firstYm && preview.navs.lastYm
                    ? `${preview.navs.firstYm} ~ ${preview.navs.lastYm}`
                    : '—'
                }
              />
              <Stat label="월 수" value={`${preview.navs.navs.length}개월`} />
              <Stat label="보유 종목" value={`${preview.holdings.holdings.length}개`} />
              <Stat
                label="통화"
                value={currencies.join(' · ') || '—'}
              />
            </dl>
          </Card>

          <Card
            title={
              <span className="flex flex-wrap items-center gap-2">
                대조
                {passes ? (
                  <Badge tone="good">일치</Badge>
                ) : (
                  <Badge tone="bad">불일치 {navMismatches.length + costMismatches.length}건</Badge>
                )}
              </span>
            }
          >
            <div className="space-y-4">
              <Muted>
                <strong>누적입금 = 입출금 누계</strong>, <strong>수익 = 평가금액 변화 − 입출금</strong>,{' '}
                <strong>매입원가 = 수량 × 단가</strong> — 셋 다 시트가 이미 한 산술입니다. 어긋나면 제가
                컬럼이나 월을 잘못 읽었다는 뜻이므로 가져오기를 막습니다.
              </Muted>

              {passes ? (
                <Alert tone="info">세 항등식이 모든 행에서 일치합니다.</Alert>
              ) : (
                <>
                  {navMismatches.length > 0 && (
                    <div>
                      <SectionTitle>{NAV_SHEET} 불일치 {navMismatches.length}건</SectionTitle>
                      <NavMismatchTable mismatches={navMismatches} />
                    </div>
                  )}
                  {costMismatches.length > 0 && (
                    <div>
                      <SectionTitle>{HOLDINGS_SHEET} 불일치 {costMismatches.length}건</SectionTitle>
                      <CostMismatchTable mismatches={costMismatches} />
                    </div>
                  )}
                </>
              )}

              {/* Without this, a month count on its own leaves the reader
                  guessing whether one was dropped. */}
              {preview.navs.gaps.length === 0 ? (
                <Muted>
                  {preview.navs.firstYm} ~ {preview.navs.lastYm} 사이에 빠진 달이 없습니다. 그 구간이 곧{' '}
                  {preview.navs.navs.length}개월이므로 <strong>빠진 달은 없습니다.</strong>
                </Muted>
              ) : (
                <Alert tone="warn">
                  {preview.navs.firstYm} ~ {preview.navs.lastYm} 사이에{' '}
                  <strong>{preview.navs.gaps.length}개월</strong>이 비어 있습니다:{' '}
                  {preview.navs.gaps.slice(0, 12).join(', ')}
                  {preview.navs.gaps.length > 12 ? ' …' : ''}
                </Alert>
              )}

              {(preview.navs.skippedRows > 0 || preview.holdings.skippedRows > 0) && (
                <Alert tone="warn">
                  값은 있는데 날짜나 종목명이 없어 건너뛴 행이 있습니다 — {NAV_SHEET}{' '}
                  {preview.navs.skippedRows}행, {HOLDINGS_SHEET} {preview.holdings.skippedRows}행.
                </Alert>
              )}

              {currencies.length > 1 && (
                <Alert tone="info">
                  외화 종목이 있습니다 ({currencies.join(' · ')}).{' '}
                  <strong>통화는 지역이 아니라 거래소로 정합니다</strong> — 미국 지수를 담아도 KRX에서
                  거래되면 원화입니다. 통화는 시세를 어디서 조회할지를 정하는 값이고,{' '}
                  <strong>금액은 모두 원화</strong>입니다.
                </Alert>
              )}

              {preview.holdings.priceScales.length > 0 && (
                <div>
                  <SectionTitle>단가 배율</SectionTitle>
                  <Muted>
                    <strong>매입원가는 통화와 무관하게 원화 컬럼</strong>입니다. <code>단가</code> 도 이미
                    환산된 값인데 엔화만 100배로 적혀 있어서(원/100엔 환율을 100으로 나누지 않은 값), 두
                    컬럼의 비가 <strong>환율이 아니라 단위 배율</strong>이 됩니다. 그래서 불일치로 보지
                    않고, 이 배율을 적용해 단가를 원화로 읽습니다.
                  </Muted>
                  <PriceScaleTable scales={preview.holdings.priceScales} />
                </div>
              )}

              {preview.holdings.costlessRows.length > 0 && (
                <Alert tone="warn">
                  다음 종목은 <strong>매입원가 칸이 비어</strong> 있어 원화 금액을 알 수 없습니다.{' '}
                  <code>수량 × 단가</code> 로 대신했는데, 엔화라면 100배 커집니다:{' '}
                  <strong>{preview.holdings.costlessRows.join(', ')}</strong>
                </Alert>
              )}
            </div>
          </Card>

          <Card title="가져오기 실행">
            <div className="space-y-3">
              {imported ? (
                <Alert tone="info">
                  가져왔습니다. <strong>포트폴리오</strong> 화면에서 확인하세요.
                </Alert>
              ) : (
                <Muted>
                  기존 증권 데이터를 <strong>덮어씁니다.</strong> 자산 대장과 보정 규칙은 건드리지
                  않습니다.
                </Muted>
              )}
              <Button onClick={apply} disabled={!passes || imported}>
                {imported ? '완료' : '가져오기'}
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

const NAV_MISMATCH_LABEL: Record<NavMismatch['kind'], string> = {
  cumulativeIn: '누적입금',
  profit: '수익',
}

function NavMismatchTable({ mismatches }: { mismatches: NavMismatch[] }) {
  return (
    <div className="max-h-64 overflow-auto rounded-lg border" style={{ borderColor: 'var(--line)' }}>
      <table className="w-full text-sm">
        <thead className="sticky top-0" style={{ background: 'var(--card)' }}>
          <tr className="border-b" style={{ borderColor: 'var(--line)' }}>
            {['월', '항목', '제 계산', '시트', '차이'].map((label, index) => (
              <th
                key={label}
                scope="col"
                className={`px-3 py-2 font-medium ${index >= 2 ? 'text-right' : 'text-left'}`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mismatches.slice(0, 200).map((mismatch) => (
            <tr key={`${mismatch.ym}-${mismatch.kind}`} className="border-b" style={{ borderColor: 'var(--line)' }}>
              <td className="px-3 py-1.5">{mismatch.ym}</td>
              <td className="px-3 py-1.5">{NAV_MISMATCH_LABEL[mismatch.kind]}</td>
              <td className="tnum px-3 py-1.5 text-right">{won.format(Math.round(mismatch.ours))}</td>
              <td className="tnum px-3 py-1.5 text-right">{won.format(Math.round(mismatch.sheet))}</td>
              <td className="tnum px-3 py-1.5 text-right">{won.format(Math.round(mismatch.diff))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CostMismatchTable({ mismatches }: { mismatches: HoldingMismatch[] }) {
  return (
    <div className="max-h-64 overflow-auto rounded-lg border" style={{ borderColor: 'var(--line)' }}>
      <table className="w-full text-sm">
        <thead className="sticky top-0" style={{ background: 'var(--card)' }}>
          <tr className="border-b" style={{ borderColor: 'var(--line)' }}>
            {['종목', '수량 × 단가', '시트', '차이'].map((label, index) => (
              <th
                key={label}
                scope="col"
                className={`px-3 py-2 font-medium ${index >= 1 ? 'text-right' : 'text-left'}`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mismatches.slice(0, 200).map((mismatch) => (
            <tr key={mismatch.name} className="border-b" style={{ borderColor: 'var(--line)' }}>
              <td className="px-3 py-1.5">{mismatch.name}</td>
              <td className="tnum px-3 py-1.5 text-right">{won.format(Math.round(mismatch.ours))}</td>
              <td className="tnum px-3 py-1.5 text-right">{won.format(Math.round(mismatch.sheet))}</td>
              <td className="tnum px-3 py-1.5 text-right">{won.format(Math.round(mismatch.diff))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PriceScaleTable({ scales }: { scales: PriceScale[] }) {
  const digits = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 4 })
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--line)' }}>
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b" style={{ borderColor: 'var(--line)' }}>
            {['종목', '통화', '수량 × 단가', '매입원가 (원)', '배율'].map((label, index) => (
              <th
                key={label}
                scope="col"
                className={`px-3 py-2 font-medium ${index >= 2 ? 'text-right' : 'text-left'}`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {scales.map((scale) => (
            <tr key={scale.name} className="border-b" style={{ borderColor: 'var(--line)' }}>
              <td className="px-3 py-1.5">{scale.name}</td>
              <td className="px-3 py-1.5">{scale.currency}</td>
              <td className="tnum px-3 py-1.5 text-right">{won.format(Math.round(scale.raw))}</td>
              <td className="tnum px-3 py-1.5 text-right">{won.format(Math.round(scale.costKrw))}</td>
              <td className="tnum px-3 py-1.5 text-right">{digits.format(scale.scale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
