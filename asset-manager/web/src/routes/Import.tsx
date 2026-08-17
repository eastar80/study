import { useMemo, useState } from 'react'
import { hasCredentials } from '../config'
import { describeUnsupportedFile, pickSpreadsheet, type PickedFile } from '../lib/google/picker'
import { getSheetGrid, getSpreadsheetOutline, type Sheet } from '../lib/google/sheets'
import {
  combine,
  crossCheck,
  crossCheckDebt,
  crossCheckNetWorth,
  parseBalanceSheet,
  parseHoldingsSheet,
  type Mismatch,
} from '../lib/import/assetWorkbook'
import {
  adjustmentKey,
  describeAdjustment,
  suggestFromMismatches,
  type AdjustmentSuggestion,
} from '../lib/import/adjustments'
import type { ImportAdjustment, Item } from '../lib/data/model'
import type { Vault } from '../state/useVault'
import { Alert, Badge, Button, Card, Field, Muted, TextInput } from '../ui/primitives'

const BALANCE_SHEET = '잔액입력'
const HOLDINGS_SHEET = '자산보유현황'

/** Wide enough for the observed sheets (59 and 26 columns) with room to grow. */
const READ_ROWS = 1000
const READ_COLS = 300

const won = new Intl.NumberFormat('ko-KR')

interface LoadedSheets {
  file: PickedFile
  balance: Sheet
  holdings: Sheet
}

export function Import({ vault, signedIn, onConnect }: { vault: Vault; signedIn: boolean; onConnect: () => void }) {
  const [sheets, setSheets] = useState<LoadedSheets | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imported, setImported] = useState(false)
  const [registering, setRegistering] = useState<AdjustmentSuggestion | null>(null)

  const ready = hasCredentials()
  const adjustments = vault.data.importAdjustments

  /**
   * Parsing is derived from the loaded grids and the current rules, so
   * registering a correction re-runs the cross-check without re-reading Sheets.
   */
  const preview = useMemo(() => {
    if (!sheets) return null
    const balances = parseBalanceSheet(sheets.balance, adjustments)
    const holdings = parseHoldingsSheet(sheets.holdings, adjustments)
    const merged = combine(balances, holdings)
    return {
      balances,
      holdings,
      merged,
      check: crossCheck(balances.ownTotals, holdings.expectedTotals),
      debtCheck: crossCheckDebt(holdings.ownDebtTotals, holdings.expectedTotals.debt),
      netCheck: crossCheckNetWorth(merged, holdings.expectedTotals),
      excludedItems: merged.items.filter((item) => item.countedElsewhere),
    }
  }, [sheets, adjustments])

  const suggestions = useMemo(
    () => (preview ? suggestFromMismatches(preview.check.mismatches) : null),
    [preview],
  )

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

      const missing = [BALANCE_SHEET, HOLDINGS_SHEET].filter((title) => !titles.includes(title))
      if (missing.length > 0) {
        setError(
          `이 파일에 ${missing.map((m) => `"${m}"`).join(', ')} 시트가 없습니다. 자산현황 파일을 골랐는지 확인해 주세요.`,
        )
        return
      }

      setProgress(`"${BALANCE_SHEET}" 읽는 중…`)
      const balance = await readSheet(file.id, BALANCE_SHEET)
      setProgress(`"${HOLDINGS_SHEET}" 읽는 중…`)
      const holdings = await readSheet(file.id, HOLDINGS_SHEET)

      setSheets({ file, balance, holdings })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setProgress(null)
    }
  }

  function addAdjustment(adjustment: ImportAdjustment) {
    vault.update((draft) => ({
      ...draft,
      importAdjustments: [...draft.importAdjustments, adjustment],
    }))
    setRegistering(null)
  }

  function removeAdjustment(target: ImportAdjustment) {
    vault.update((draft) => ({
      ...draft,
      importAdjustments: draft.importAdjustments.filter(
        (candidate) => adjustmentKey(candidate) !== adjustmentKey(target),
      ),
    }))
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
  const adjustedCells = preview ? preview.balances.adjustedCells + preview.holdings.adjustedCells : 0

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
                {progress ? '읽는 중…' : sheets ? '다시 읽기' : '자산현황 파일 선택'}
              </Button>
              {sheets && <Badge tone="brand">{sheets.file.name}</Badge>}
            </div>
          )}

          {progress && <Muted>{progress}</Muted>}
          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Card>

      {adjustments.length > 0 && (
        <Card title={`적용 중인 보정 ${adjustments.length}건`}>
          <div className="space-y-3">
            <Muted>
              원본 시트의 값이 실제와 다를 때 쓰는 규칙입니다. 데이터에 저장되므로 <strong>다시
              가져와도 유지됩니다.</strong> 시트를 직접 고치셨다면 여기서 규칙을 지우세요.
            </Muted>
            <ul className="space-y-2">
              {adjustments.map((adjustment) => (
                <li
                  key={adjustmentKey(adjustment)}
                  className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--line)' }}
                >
                  <span className="font-mono text-xs">{describeAdjustment(adjustment)}</span>
                  <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--ink-muted)' }}>
                    {adjustment.reason}
                  </span>
                  <Button variant="danger" onClick={() => removeAdjustment(adjustment)}>
                    삭제
                  </Button>
                </li>
              ))}
            </ul>
            {adjustedCells > 0 && (
              <Muted>이번 읽기에서 {won.format(adjustedCells)}개 셀에 반영되었습니다.</Muted>
            )}
          </div>
        </Card>
      )}

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

              {/* B~H covers assets only, and 마통 is not among them, so the debt
                  columns had no verification at all until this. */}
              <div className="space-y-2">
                <SectionTitle>부채 합계 (T열)</SectionTitle>
                {preview.debtCheck.length === 0 ? (
                  <Muted>L~S를 더한 값이 모든 달에서 T열과 일치합니다.</Muted>
                ) : (
                  <Alert tone="warn">
                    L~S를 더한 값이 T열과 <strong>{preview.debtCheck.length}개월</strong> 다릅니다. 첫 달{' '}
                    {preview.debtCheck[0]!.ym}: 제 합계 {won.format(Math.round(preview.debtCheck[0]!.ours))}원 ·
                    시트 {won.format(Math.round(preview.debtCheck[0]!.sheet))}원. 마통은 {BALANCE_SHEET} 소속이라
                    이 비교에서 제외했는데, T열이 마통을 포함한다면 그 차이일 수 있습니다.{' '}
                    <strong>가져오기를 막지는 않습니다.</strong>
                  </Alert>
                )}
              </div>

              {/* The only check that sees a value counted twice across the two
                  sheets — each of the others verifies its own slice. */}
              <div className="space-y-2">
                <SectionTitle>순자산 (J열)</SectionTitle>
                {preview.netCheck.length === 0 ? (
                  <Muted>
                    가져올 데이터로 계산한 순자산이 모든 달에서 J열과 일치합니다. 자산·부채·중복까지
                    한 번에 맞는다는 뜻입니다.
                  </Muted>
                ) : (
                  <Alert tone="warn">
                    계산한 순자산이 J열과 <strong>{preview.netCheck.length}개월</strong> 다릅니다. 첫 달{' '}
                    {preview.netCheck[0]!.ym}: 제 순자산{' '}
                    {won.format(Math.round(preview.netCheck[0]!.ourNet))}원 · 시트{' '}
                    {won.format(Math.round(preview.netCheck[0]!.sheetNet))}원 (차이{' '}
                    {won.format(Math.round(preview.netCheck[0]!.diff))}원).
                    {Math.abs(preview.netCheck[0]!.ourAsset - preview.netCheck[0]!.sheetAsset) <= 1
                      ? ' 자산은 일치하므로 부채 쪽입니다 — 두 시트에 겹쳐 들어간 항목이 더 있을 수 있습니다.'
                      : ' 자산도 어긋나므로 분류 매핑부터 확인해야 합니다.'}{' '}
                    <strong>가져오기를 막지는 않습니다.</strong>
                  </Alert>
                )}
              </div>

              {preview.excludedItems.length > 0 && (
                <Alert tone="info">
                  다음 항목은 다른 항목에 이미 포함되어 있어 <strong>합계에 넣지 않습니다.</strong> 대장에는
                  그대로 보입니다.
                  <ul className="mt-1.5 space-y-0.5">
                    {preview.excludedItems.map((item) => (
                      <li key={item.id}>
                        <strong>{item.name}</strong> — {item.countedElsewhere}
                      </li>
                    ))}
                  </ul>
                </Alert>
              )}

              {preview.holdings.creditCells > 0 && (
                <Alert tone="info">
                  부채 컬럼에 음수가 <strong>{preview.holdings.creditCells}개</strong> 있어, 그 달에는 해당
                  계좌가 빚이 아니라 <strong>돈을 들고 있었다</strong>고 읽었습니다. 대장에서 음수로 표시되고
                  부채 합계에서 차감됩니다.
                </Alert>
              )}

              {passes ? (
                <Alert tone="info">모든 월·모든 분류의 합계가 일치합니다.</Alert>
              ) : (
                <>
                  {suggestions && suggestions.suggestions.length > 0 && (
                    <div className="space-y-2">
                      <SectionTitle>규칙 하나로 덮을 수 있는 차이</SectionTitle>
                      {suggestions.suggestions.map((suggestion) => (
                        <div
                          key={suggestion.category}
                          className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 text-sm"
                          style={{ borderColor: 'var(--line)' }}
                        >
                          <Badge tone="warn">{suggestion.category}</Badge>
                          <span className="tnum">
                            {suggestion.fromYm} ~ {suggestion.toYm} ({suggestion.monthCount}개월) ·{' '}
                            <strong>
                              {suggestion.delta > 0 ? '+' : '−'}
                              {won.format(Math.abs(suggestion.delta))}원
                            </strong>
                          </span>
                          <Button onClick={() => setRegistering(suggestion)}>보정 등록</Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {suggestions && suggestions.rejected.length > 0 && (
                    <Alert tone="warn">
                      <strong>규칙 하나로 덮을 수 없는 분류</strong>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {suggestions.rejected.map((entry) => (
                          <li key={entry.category}>
                            <strong>{entry.category}</strong> — {entry.reason}
                          </li>
                        ))}
                      </ul>
                    </Alert>
                  )}

                  {registering && preview && (
                    <AdjustmentForm
                      suggestion={registering}
                      items={preview.merged.items}
                      categoryName={registering.category}
                      onCancel={() => setRegistering(null)}
                      onSubmit={addAdjustment}
                    />
                  )}

                  <MismatchTable mismatches={preview.check.mismatches} />
                </>
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
                  합계가 맞지 않는 상태로는 가져올 수 없습니다. 위에서 보정을 등록하거나, 어느 분류·어느
                  월이 틀렸는지 알려주시면 해석 규칙을 고치겠습니다.
                </Alert>
              )}

              <Alert tone="warn">
                가져오기는 현재 앱의 <strong>분류·항목·월별 기록·노트를 덮어씁니다.</strong> 보정 규칙과
                환경 설정은 유지됩니다.
              </Alert>

              {imported ? (
                <Alert tone="info">
                  가져왔습니다. Drive의 <code>/Asset Manager/data.json</code> 에 저장됩니다
                  {vault.dirty ? ' (저장 중…)' : ''}. <strong>자산 관리</strong> 화면에서 확인하세요.
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

/**
 * The suggestion knows the category, the amount and the range, but not which
 * item in that category holds the wrong value — only the user knows that.
 */
function AdjustmentForm({
  suggestion,
  items,
  categoryName,
  onCancel,
  onSubmit,
}: {
  suggestion: AdjustmentSuggestion
  items: Item[]
  categoryName: string
  onCancel: () => void
  onSubmit: (adjustment: ImportAdjustment) => void
}) {
  // Items keep their source column, which is what the rule addresses.
  const candidates = items.filter((item) => item.sourceKey)
  const [sourceKey, setSourceKey] = useState('')
  const [reason, setReason] = useState('')

  const chosen = candidates.find((item) => item.sourceKey === sourceKey)

  return (
    <div className="space-y-4 rounded-xl border p-4" style={{ borderColor: 'var(--line)' }}>
      <SectionTitle>보정 등록 — {categoryName}</SectionTitle>

      <Muted>
        {suggestion.fromYm} ~ {suggestion.toYm} 구간에서 이 분류의 합계가 시트보다{' '}
        {won.format(Math.abs(suggestion.delta))}원 {suggestion.delta < 0 ? '큽니다' : '작습니다'}.
        <strong> 어느 항목에서 조정할지 골라 주세요.</strong>
      </Muted>

      <Field label="항목" hint="원본 시트의 컬럼 문자로 규칙이 저장되므로, 다시 가져와도 같은 항목에 적용됩니다.">
        <select
          value={sourceKey}
          onChange={(event) => setSourceKey(event.target.value)}
          className="w-full rounded-xl border bg-transparent px-3 py-2 text-sm"
          style={{ borderColor: 'var(--line)' }}
        >
          <option value="">— 선택 —</option>
          {candidates.map((item) => (
            <option key={item.id} value={item.sourceKey}>
              {item.sourceKey}열 · {item.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="사유" hint="나중에 이 숫자가 시트와 다른 이유를 설명해 줍니다.">
        <TextInput value={reason} onChange={setReason} placeholder="예: 무가치 채권이 액면가로 남아 있음" />
      </Field>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <Stat label="적용 금액" value={`${suggestion.delta > 0 ? '+' : '−'}${won.format(Math.abs(suggestion.delta))}원`} />
        <Stat label="적용 기간" value={`${suggestion.fromYm} ~ ${suggestion.toYm}`} />
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() =>
            onSubmit({
              sourceKey,
              sheet: 'BALANCE',
              fromYm: suggestion.fromYm,
              toYm: suggestion.toYm,
              delta: suggestion.delta,
              reason: reason.trim() || `${categoryName} 합계 보정`,
            })
          }
          disabled={!chosen}
        >
          등록
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          취소
        </Button>
        {!chosen && <Muted>항목을 골라야 등록할 수 있습니다.</Muted>}
      </div>
    </div>
  )
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
        <Muted>
          총 {mismatches.length}건 중 앞 {shown.length}건만 표시했습니다.
        </Muted>
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
