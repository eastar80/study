import { useState } from 'react'
import { hasCredentials } from '../config'
import { pickSpreadsheet, type PickedFile } from '../lib/google/picker'
import { inspectSpreadsheet } from '../lib/inspect/inspector'
import type { InspectionReport, SheetReport } from '../lib/inspect/types'
import { Alert, Badge, Button, Card, Muted } from '../ui/primitives'

const NATURE_LABEL: Record<SheetReport['nature'], string> = {
  'ledger-monthwise': '월별 자산 대장 (열 = 월)',
  'ledger-rowwise': '월별 자산 대장 (행 = 월)',
  holdings: '보유 종목 목록',
  transactions: '매매 거래 이력',
  reference: '참조/메모 표',
  unknown: '판별 못함',
}

const KIND_LABEL: Record<string, string> = {
  currency: '금액',
  percent: '퍼센트',
  date: '날짜',
  number: '숫자',
  text: '텍스트',
  empty: '빈칸',
}

const GROUPING_LABEL: Record<SheetReport['grouping']['verdict'], string> = {
  'merged-cells': '병합 셀로 그룹 표현',
  'background-colour': '배경색으로 그룹 표현',
  indentation: '들여쓰기로 그룹 표현',
  bold: '굵은 글씨로 그룹 표현',
  'separate-column': '별도 컬럼으로 그룹 표현',
  unclear: '판별 못함',
}

export function Inspect({ signedIn, onConnect }: { signedIn: boolean; onConnect: () => void }) {
  const [file, setFile] = useState<PickedFile | null>(null)
  const [report, setReport] = useState<InspectionReport | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const ready = hasCredentials()

  async function run() {
    setError(null)
    setReport(null)
    setCopied(false)
    try {
      const picked = await pickSpreadsheet()
      if (!picked) return
      setFile(picked)
      setProgress('시작하는 중…')
      const result = await inspectSpreadsheet(picked.id, setProgress)
      setReport(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setProgress(null)
    }
  }

  function download() {
    if (!report) return
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `sheet-structure-${report.spreadsheetTitle.replace(/[^\w가-힣-]+/g, '_')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function copy() {
    if (!report) return
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="space-y-5">
      <Card title="시트 구조 분석">
        <div className="space-y-4">
          <Muted>
            기존 자산 시트를 골라 구조를 읽습니다. 병합 셀·배경색·숫자 서식처럼 화면 캡처로는 알 수
            없는 정보까지 확인해, 임포터가 어떤 규칙으로 데이터를 옮겨야 하는지 결정합니다.
          </Muted>

          <Alert tone="info">
            <strong>보고서에는 금액이 담기지 않습니다.</strong> 숫자 셀은 값 대신 자릿수 통계만
            기록합니다(금리 1~2자리와 잔액 8~10자리를 구분해야 하기 때문입니다). 항목명·카테고리명
            같은 텍스트와 셀 메모는 구조 파악에 필요하므로 일부 포함됩니다.
          </Alert>

          {!ready && (
            <Alert tone="warn">
              먼저 <strong>환경 설정</strong>에서 Google 클라이언트 ID와 API 키를 입력하세요.
            </Alert>
          )}

          {ready && !signedIn && (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={onConnect}>Google Drive 연결</Button>
              <Muted>내가 직접 고른 파일에만 접근합니다.</Muted>
            </div>
          )}

          {ready && signedIn && (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={run} disabled={progress !== null}>
                {progress ? '분석 중…' : file ? '다른 시트 분석' : '시트 선택하고 분석'}
              </Button>
              {file && <Badge tone="brand">{file.name}</Badge>}
            </div>
          )}

          {progress && <Muted>{progress}</Muted>}
          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Card>

      {report && (
        <>
          <Card
            title={`분석 결과 — ${report.spreadsheetTitle}`}
            action={
              <div className="flex gap-2">
                <Button variant="ghost" onClick={copy}>
                  {copied ? '복사했습니다' : '보고서 복사'}
                </Button>
                <Button variant="ghost" onClick={download}>
                  JSON 저장
                </Button>
              </div>
            }
          >
            <div className="space-y-4">
              <Muted>
                시트 {report.sheetCount}개 · 로케일 {report.locale ?? '알 수 없음'} · 생성{' '}
                {new Date(report.generatedAtIso).toLocaleString('ko-KR')}
              </Muted>

              {report.warnings.length > 0 && (
                <Alert tone="warn">
                  <strong>확인이 필요한 점</strong>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {report.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </Alert>
              )}

              <Alert tone="info">
                위 <strong>보고서 복사</strong>를 누른 뒤 대화에 붙여주시면 이 구조에 맞춘 임포터
                매핑표를 확정합니다.
              </Alert>
            </div>
          </Card>

          {report.sheets.map((sheet) => (
            <SheetPanel key={`${sheet.index}-${sheet.title}`} sheet={sheet} />
          ))}
        </>
      )}
    </div>
  )
}

function SheetPanel({ sheet }: { sheet: SheetReport }) {
  const axis = sheet.monthAxis

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {sheet.title}
          <Badge tone={sheet.nature === 'unknown' ? 'warn' : 'good'}>{NATURE_LABEL[sheet.nature]}</Badge>
          {sheet.hidden && <Badge>숨김 시트</Badge>}
        </span>
      }
    >
      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
          <Stat label="크기" value={`${sheet.rowCount}행 × ${sheet.columnCount}열`} />
          <Stat label="스캔 범위" value={`${sheet.scannedRows}행 × ${sheet.scannedColumns}열`} />
          <Stat label="고정 행/열" value={`${sheet.frozenRows} / ${sheet.frozenColumns}`} />
          <Stat
            label="헤더 행"
            value={sheet.headerRowIndex === null ? '없음' : `${sheet.headerRowIndex + 1}행`}
          />
        </dl>

        <div>
          <SectionTitle>월 축</SectionTitle>
          {axis.axis === 'none' ? (
            <Muted>월 헤더를 찾지 못했습니다.</Muted>
          ) : (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
              <Stat label="방향" value={axis.axis === 'columns' ? '가로 (열 = 월)' : '세로 (행 = 월)'} />
              <Stat
                label="헤더 위치"
                value={
                  axis.axis === 'columns'
                    ? `${(axis.headerRowIndex ?? 0) + 1}행`
                    : `${(axis.headerColumnIndex ?? 0) + 1}열`
                }
              />
              <Stat label="월 개수" value={`${axis.tokenCount}개`} />
              <Stat
                label="기간"
                value={axis.firstYm && axis.lastYm ? `${axis.firstYm} ~ ${axis.lastYm}` : '연도 없음'}
              />
            </dl>
          )}
        </div>

        <div>
          <SectionTitle>분류 표현 방식</SectionTitle>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={sheet.grouping.verdict === 'unclear' ? 'warn' : 'brand'}>
              {GROUPING_LABEL[sheet.grouping.verdict]}
            </Badge>
            <Muted>
              병합 {sheet.grouping.mergeCount}개(라벨 {sheet.grouping.mergedLabelCells}개) · 배경색{' '}
              {sheet.grouping.distinctBackgrounds.length}종 · 들여쓰기{' '}
              {sheet.grouping.indentHistogram.map((h) => `${h.indent}칸×${h.rows}`).join(', ') || '없음'} ·
              굵은 라벨 {sheet.grouping.boldLabelRows}행
            </Muted>
          </div>
          {sheet.grouping.totalRows.length > 0 && (
            <p className="mt-2 text-sm">
              합계로 보이는 행: {sheet.grouping.totalRows.join(', ')}
            </p>
          )}
        </div>

        {(sheet.currencies.length > 0 || sheet.percentCells > 0 || sheet.noteCells > 0) && (
          <div>
            <SectionTitle>통화 · 금리 · 메모</SectionTitle>
            <div className="flex flex-wrap items-center gap-2">
              {sheet.currencies.map((code) => (
                <Badge key={code} tone="brand">
                  {code}
                </Badge>
              ))}
              {sheet.currencies.length === 0 && <Muted>통화 서식이 지정된 셀이 없습니다.</Muted>}
              {sheet.percentCells > 0 && <Badge tone="warn">퍼센트 셀 {sheet.percentCells}개</Badge>}
              {sheet.noteCells > 0 && <Badge tone="good">셀 메모 {sheet.noteCells}개</Badge>}
            </div>
            {sheet.fxHints.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {sheet.fxHints.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            )}
            {sheet.noteSamples.length > 0 && (
              <p className="mt-2 text-sm" style={{ color: 'var(--ink-muted)' }}>
                메모 예: {sheet.noteSamples.map((note) => `"${note}"`).join(' · ')}
              </p>
            )}
          </div>
        )}

        <div>
          <SectionTitle>컬럼 ({sheet.columns.length}개)</SectionTitle>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--line)', color: 'var(--ink-muted)' }}>
                  <Th>열</Th>
                  <Th>헤더</Th>
                  <Th>성격</Th>
                  <Th>채워짐</Th>
                  <Th>자릿수</Th>
                  <Th>비고</Th>
                </tr>
              </thead>
              <tbody>
                {sheet.columns.slice(0, 40).map((column) => (
                  <tr key={column.index} className="border-b" style={{ borderColor: 'var(--line)' }}>
                    <Td mono>{column.letter}</Td>
                    <Td>{column.header ?? <span className="opacity-40">—</span>}</Td>
                    <Td>
                      {KIND_LABEL[column.kind] ?? column.kind}
                      {column.currency && <Badge tone="brand">{column.currency}</Badge>}
                    </Td>
                    <Td mono>{column.filled}</Td>
                    <Td mono>
                      {column.numericShape
                        ? `${column.numericShape.minIntDigits}~${column.numericShape.maxIntDigits}${
                            column.numericShape.hasDecimals ? ' (소수)' : ''
                          }${column.numericShape.anyNegative ? ' (음수)' : ''}`
                        : '—'}
                    </Td>
                    <Td>
                      {column.monthHits > 0 && <Badge tone="good">월 {column.monthHits}</Badge>}
                      {column.tickerHits && (
                        <Badge tone="warn">
                          티커 국내{column.tickerHits.krx}/해외{column.tickerHits.foreign}
                        </Badge>
                      )}
                      {column.textSamples && (
                        <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                          {column.textSamples.slice(0, 4).join(', ')}
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {sheet.redactedSamples.length > 0 && (
          <div>
            <SectionTitle>샘플 행 (금액 가림)</SectionTitle>
            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--line)' }}>
              <table className="w-full text-left text-xs">
                <tbody>
                  {sheet.redactedSamples.map((row, index) => (
                    <tr key={index} className="border-b last:border-0" style={{ borderColor: 'var(--line)' }}>
                      {row.slice(0, 14).map((cell, cellIndex) => (
                        <td key={cellIndex} className="whitespace-nowrap px-2.5 py-1.5 font-mono">
                          {cell || <span className="opacity-25">·</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>
      {children}
    </h3>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </dt>
      <dd className="tnum font-medium">{value}</dd>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-2.5 py-2 text-xs font-medium">{children}</th>
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td className={`px-2.5 py-2 align-top ${mono ? 'tnum font-mono text-xs' : ''}`}>
      <span className="flex flex-wrap items-center gap-1.5">{children}</span>
    </td>
  )
}
