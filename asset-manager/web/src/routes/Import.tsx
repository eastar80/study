import { useState } from 'react'
import { hasCredentials } from '../config'
import { describeUnsupportedFile, pickSpreadsheet, type PickedFile } from '../lib/google/picker'
import { getSheetGrid, getSpreadsheetOutline, type Sheet } from '../lib/google/sheets'
import {
  combine,
  crossCheck,
  parseBalanceSheet,
  parseHoldingsSheet,
  type Mismatch,
  type ParsedBalances,
  type ParsedHoldings,
} from '../lib/import/assetWorkbook'
import type { Vault } from '../state/useVault'
import { Alert, Badge, Button, Card, Muted } from '../ui/primitives'

const BALANCE_SHEET = '잔액입력'
const HOLDINGS_SHEET = '자산보유현황'

/** Wide enough for the observed sheets (59 and 26 columns) with room to grow. */
const READ_ROWS = 1000
const READ_COLS = 300

interface Preview {
  file: PickedFile
  balances: ParsedBalances
  holdings: ParsedHoldings
  merged: ReturnType<typeof combine>
  check: ReturnType<typeof crossCheck>
}

const won = new Intl.NumberFormat('ko-KR')

export function Import({ vault, signedIn, onConnect }: { vault: Vault; signedIn: boolean; onConnect: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imported, setImported] = useState(false)

  const ready = hasCredentials()

  async function load() {
    setError(null)
    setPreview(null)
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

      const missing = [BALANCE_SHEET, HOLDINGS_SHEET].filter((title) => !titles.includes(title))
      if (missing.length > 0) {
        setError(
          `이 파일에 ${missing.map((m) => `"${m}"`).join(', ')} 시트가 없습니다. 자산현황 파일을 골랐는지 확인해 주세요.`,
        )
        return
      }

      setProgress(`"${BALANCE_SHEET}" 읽는 중…`)
      const balanceSheet = await readSheet(file.id, BALANCE_SHEET)
      setProgress(`"${HOLDINGS_SHEET}" 읽는 중…`)
      const holdingsSheet = await readSheet(file.id, HOLDINGS_SHEET)

      setProgress('구조 해석 중…')
      const balances = parseBalanceSheet(balanceSheet)
      const holdings = parseHoldingsSheet(holdingsSheet)
      const merged = combine(balances, holdings)
      const check = crossCheck(balances.ownTotals, holdings.expectedTotals)

      setPreview({ file, balances, holdings, merged, check })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setProgress(null)
    }
  }

  function apply() {
    if (!preview) return
    const { merged } = preview
    vault.update((draft) => ({
      ...draft,
      categories: merged.categories,
      items: merged.items,
      snapshots: merged.snapshots,
      notes: merged.notes,
    }))
    setImported(true)
  }

  const passes = preview !== null && preview.check.mismatches.length === 0

  return (
    <div className="space-y-5">
      <Card title="자산현황 워크북 가져오기">
        <div className="space-y-4">
          <Muted>
            <strong>{BALANCE_SHEET}</strong> 에서 자산을, <strong>{HOLDINGS_SHEET}</strong> 의 L열 이후에서
            부채를 가져옵니다. 두 시트의 집계 컬럼(B~K, T~W)은 시트가 스스로 계산한 값이므로 가져오지
            않고, 대신 <strong>제 계산과 대조하는 데 씁니다.</strong>
          </Muted>

          {!ready && (
            <Alert tone="warn">
              먼저 <strong>환경 설정</strong>에서 클라이언트 ID와 API 키를 입력하세요.
            </Alert>
          )}

          {ready && !signedIn && <Button onClick={onConnect}>Google Drive 연결</Button>}

          {ready && signedIn && (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={load} disabled={progress !== null}>
                {progress ? '읽는 중…' : preview ? '다시 읽기' : '자산현황 파일 선택'}
              </Button>
              {preview && <Badge tone="brand">{preview.file.name}</Badge>}
            </div>
          )}

          {progress && <Muted>{progress}</Muted>}
          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Card>

      {preview && (
        <>
          <Card title="가져올 내용">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
              <Stat label="분류" value={`${preview.merged.categories.length}개`} />
              <Stat label="항목" value={`${preview.merged.items.length}개`} />
              <Stat label="월별 기록" value={`${won.format(preview.merged.snapshots.length)}건`} />
              <Stat
                label="기간"
                value={
                  preview.balances.firstYm && preview.balances.lastYm
                    ? `${preview.balances.firstYm} ~ ${preview.balances.lastYm}`
                    : '—'
                }
              />
            </dl>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {preview.merged.categories.map((category) => (
                <Badge key={category.id} tone={category.kind === 'DEBT' ? 'bad' : 'good'}>
                  {category.name}
                  {category.kind === 'DEBT' && ' (부채)'}
                </Badge>
              ))}
            </div>
          </Card>

          <Card
            title={
              <span className="flex flex-wrap items-center gap-2">
                합계 대조
                {passes ? (
                  <Badge tone="good">일치</Badge>
                ) : (
                  <Badge tone="bad">불일치 {preview.check.mismatches.length}건</Badge>
                )}
              </span>
            }
          >
            <div className="space-y-4">
              <Muted>
                제가 항목별로 더한 값을 <strong>{HOLDINGS_SHEET}</strong> 가 직접 계산해 둔 대분류 합계와 월
                단위로 비교합니다. 여기가 일치하면 분류와 월이 제자리에 들어갔다는 뜻입니다.
              </Muted>

              {preview.check.comparedCategories.length > 0 && (
                <p className="text-sm">
                  대조한 분류:{' '}
                  <span className="font-medium">{preview.check.comparedCategories.join(', ')}</span>
                </p>
              )}

              {preview.check.unmatchedSheetCategories.length > 0 && (
                <Alert tone="warn">
                  {HOLDINGS_SHEET} 의 다음 분류를 {BALANCE_SHEET} 에서 찾지 못해 대조하지 못했습니다:{' '}
                  <strong>{preview.check.unmatchedSheetCategories.join(', ')}</strong>
                </Alert>
              )}

              {passes ? (
                <Alert tone="info">모든 월·모든 분류의 합계가 일치합니다.</Alert>
              ) : (
                <MismatchTable mismatches={preview.check.mismatches} />
              )}
            </div>
          </Card>

          {(preview.balances.droppedRows.length > 0 ||
            preview.balances.renamedItems.length > 0 ||
            preview.balances.unclassifiedColumns.length > 0) && (
            <Card title="확인이 필요한 점">
              <div className="space-y-4 text-sm">
                {preview.balances.droppedRows.length > 0 && (
                  <div>
                    <SectionTitle>한 달에 두 행이 있어 나중 행을 사용함</SectionTitle>
                    <ul className="list-disc space-y-1 pl-5">
                      {preview.balances.droppedRows.map((row) => (
                        <li key={`${row.ym}-${row.date}`}>{row.reason}</li>
                      ))}
                    </ul>
                    <Muted>
                      기초 잔액 행으로 보입니다. 이 값을 살리고 싶으면 알려주세요 — 이전 달로 옮겨
                      넣을 수 있습니다.
                    </Muted>
                  </div>
                )}

                {preview.balances.renamedItems.length > 0 && (
                  <div>
                    <SectionTitle>이름이 겹쳐 번호를 붙인 항목</SectionTitle>
                    <ul className="list-disc space-y-1 pl-5">
                      {preview.balances.renamedItems.map((item) => (
                        <li key={item.sourceKey}>
                          {item.sourceKey}열 · {item.original} → <strong>{item.assigned}</strong>
                        </li>
                      ))}
                    </ul>
                    <Muted>가져온 뒤 자산 관리 화면에서 알아보기 쉬운 이름으로 고칠 수 있습니다.</Muted>
                  </div>
                )}

                {preview.balances.unclassifiedColumns.length > 0 && (
                  <div>
                    <SectionTitle>대분류가 비어 있어 가져오지 않은 컬럼</SectionTitle>
                    <p>{preview.balances.unclassifiedColumns.join(', ')}열</p>
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card title="가져오기 실행">
            <div className="space-y-4">
              {!passes && (
                <Alert tone="error">
                  합계가 맞지 않는 상태로는 가져올 수 없습니다. 어느 분류·어느 월이 틀렸는지 위 표를
                  알려주시면 해석 규칙을 고치겠습니다.
                </Alert>
              )}

              <Alert tone="warn">
                가져오기는 현재 앱의 <strong>분류·항목·월별 기록·노트를 모두 덮어씁니다.</strong> 지금은
                비어 있으니 처음 가져올 때는 문제가 없습니다.
              </Alert>

              {imported ? (
                <Alert tone="info">
                  가져왔습니다. Drive의 <code>/Asset Manager/data.json</code> 에 저장됩니다
                  {vault.dirty ? ' (저장 중…)' : ''}.
                </Alert>
              ) : (
                <Button onClick={apply} disabled={!passes}>
                  {won.format(preview.merged.snapshots.length)}건 가져오기
                </Button>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

async function readSheet(spreadsheetId: string, title: string): Promise<Sheet> {
  const response = await getSheetGrid(spreadsheetId, title, READ_ROWS, READ_COLS)
  const sheet = response.sheets?.[0]
  if (!sheet) throw new Error(`"${title}" 시트를 읽지 못했습니다.`)
  return sheet
}

function MismatchTable({ mismatches }: { mismatches: Mismatch[] }) {
  const shown = mismatches.slice(0, 40)
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--line)' }}>
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--line)', color: 'var(--ink-muted)' }}>
              <th className="px-3 py-2 text-xs font-medium">월</th>
              <th className="px-3 py-2 text-xs font-medium">분류</th>
              <th className="px-3 py-2 text-right text-xs font-medium">내 계산</th>
              <th className="px-3 py-2 text-right text-xs font-medium">시트 값</th>
              <th className="px-3 py-2 text-right text-xs font-medium">차이</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((mismatch) => (
              <tr
                key={`${mismatch.ym}-${mismatch.category}`}
                className="border-b last:border-0"
                style={{ borderColor: 'var(--line)' }}
              >
                <td className="tnum px-3 py-2 font-mono text-xs">{mismatch.ym}</td>
                <td className="px-3 py-2">{mismatch.category}</td>
                <td className="tnum px-3 py-2 text-right">{won.format(Math.round(mismatch.ours))}</td>
                <td className="tnum px-3 py-2 text-right">{won.format(Math.round(mismatch.sheet))}</td>
                <td className="tnum px-3 py-2 text-right font-medium text-rose-600 dark:text-rose-400">
                  {mismatch.diff > 0 ? '+' : ''}
                  {won.format(Math.round(mismatch.diff))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mismatches.length > shown.length && (
        <Muted>총 {mismatches.length}건 중 앞 {shown.length}건만 표시했습니다.</Muted>
      )}
    </div>
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
