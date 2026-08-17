import { useMemo, useState } from 'react'
import {
  availableYears,
  buildLedger,
  monthsOfYear,
  setCell,
  type Cell,
  type LedgerRow,
} from '../lib/data/ledger'
import { formatAmount, formatChange, formatRate, monthLabel, parseAmount } from '../lib/data/format'
import type { Item } from '../lib/data/model'
import type { Vault } from '../state/useVault'
import { Alert, Badge, Button, Card, Muted } from '../ui/primitives'

/** Rows that show an aggregate rather than an editable item. */
const AGGREGATE: ReadonlySet<LedgerRow['kind']> = new Set([
  'group',
  'subtotal',
  'assetTotal',
  'debtTotal',
  'netWorth',
])

export function Ledger({ vault }: { vault: Vault }) {
  const { data } = vault
  const years = useMemo(() => availableYears(data.snapshots), [data.snapshots])
  const thisYear = new Date().getFullYear()

  const [year, setYear] = useState(() => years.at(-1) ?? thisYear)
  const [showHidden, setShowHidden] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<{ row: LedgerRow; index: number } | null>(null)

  const mask = data.settings.maskAmounts
  const months = useMemo(() => monthsOfYear(year), [year])
  const rows = useMemo(
    () => buildLedger(data, year, { showHidden, collapsed }),
    [data, year, showHidden, collapsed],
  )

  function toggleCollapse(categoryId: string) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }

  function commit(row: LedgerRow, index: number, value: number | null, memo: string | null) {
    const item = row.item
    const isDebt = row.category?.kind === 'DEBT'
    if (!item) return
    const ym = months[index]!
    vault.update((draft) => ({
      ...draft,
      snapshots: setCell(draft.snapshots, item, Boolean(isDebt), ym, value, memo),
    }))
    setEditing(null)
  }

  function renameItem(item: Item, name: string) {
    const trimmed = name.trim()
    if (trimmed === '' || trimmed === item.name) return
    vault.update((draft) => ({
      ...draft,
      items: draft.items.map((candidate) => (candidate.id === item.id ? { ...candidate, name: trimmed } : candidate)),
    }))
  }

  function setHidden(item: Item, hidden: boolean) {
    vault.update((draft) => ({
      ...draft,
      items: draft.items.map((candidate) => (candidate.id === item.id ? { ...candidate, hidden } : candidate)),
    }))
  }

  function toggleMask() {
    vault.update((draft) => ({
      ...draft,
      settings: { ...draft.settings, maskAmounts: !draft.settings.maskAmounts },
    }))
  }

  const hiddenCount = data.items.filter((item) => item.hidden).length

  if (data.items.length === 0) {
    return (
      <Card title="자산 관리">
        <div className="space-y-3">
          <Muted>아직 자산 항목이 없습니다.</Muted>
          <Alert tone="info">
            <strong>가져오기</strong> 화면에서 자산현황 워크북을 불러오면 이 표가 채워집니다.
          </Alert>
        </div>
      </Card>
    )
  }

  const firstYear = years[0] ?? year
  const lastYear = years.at(-1) ?? year

  return (
    <div className="space-y-5">
      <Card
        title={
          <span className="flex flex-wrap items-center gap-2">
            {year}년 자산 대장
            <Badge tone="neutral">
              {years.length > 0 ? `${firstYear} ~ ${lastYear}` : '데이터 없음'}
            </Badge>
          </span>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => setYear((y) => y - 1)} disabled={year <= firstYear}>
              ◀
            </Button>
            <select
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              className="rounded-xl border bg-transparent px-3 py-2 text-sm"
              style={{ borderColor: 'var(--line)' }}
            >
              {years.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}년
                </option>
              ))}
              {!years.includes(year) && <option value={year}>{year}년</option>}
            </select>
            <Button variant="ghost" onClick={() => setYear((y) => y + 1)} disabled={year >= lastYear}>
              ▶
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={toggleMask}>
            {mask ? '금액 보이기' : '금액 숨기기'}
          </Button>
          {hiddenCount > 0 && (
            <Button variant="ghost" onClick={() => setShowHidden((value) => !value)}>
              {showHidden ? '숨긴 항목 감추기' : `숨긴 항목 ${hiddenCount}개 보기`}
            </Button>
          )}
          <Muted>셀을 눌러 금액과 메모를 고칩니다. 부채는 양수로 입력하세요.</Muted>
        </div>
      </Card>

      <div
        className="overflow-x-auto rounded-2xl border bg-[var(--card)]"
        style={{ borderColor: 'var(--line)' }}
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th
                className="sticky left-0 z-20 min-w-[220px] border-b border-r bg-[var(--card)] px-3 py-2.5 text-left text-xs font-medium"
                style={{ borderColor: 'var(--line)', color: 'var(--ink-muted)' }}
              >
                항목
              </th>
              {months.map((ym) => (
                <th
                  key={ym}
                  className="border-b px-3 py-2.5 text-right text-xs font-medium whitespace-nowrap"
                  style={{ borderColor: 'var(--line)', color: 'var(--ink-muted)' }}
                >
                  {monthLabel(ym)}
                </th>
              ))}
              <th
                className="border-b border-l px-3 py-2.5 text-right text-xs font-medium whitespace-nowrap"
                style={{ borderColor: 'var(--line)', color: 'var(--ink-muted)' }}
              >
                연간 증감
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                mask={mask}
                collapsed={row.category ? collapsed.has(row.category.id) : false}
                onToggleCollapse={toggleCollapse}
                editing={editing?.row.id === row.id ? editing.index : null}
                onStartEdit={(index) => setEditing({ row, index })}
                onCancelEdit={() => setEditing(null)}
                onCommit={(index, value, memo) => commit(row, index, value, memo)}
                onRename={renameItem}
                onSetHidden={setHidden}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function rowStyle(kind: LedgerRow['kind']): string {
  switch (kind) {
    case 'group':
      return 'bg-[var(--surface)] font-semibold'
    case 'subtotal':
      return 'bg-[var(--surface)]/60 text-[13px]'
    case 'assetTotal':
      return 'bg-emerald-50 font-semibold dark:bg-emerald-950/40'
    case 'debtTotal':
      return 'bg-rose-50 font-semibold dark:bg-rose-950/40'
    case 'netWorth':
      return 'bg-brand-50 font-bold dark:bg-brand-700/20'
    default:
      return ''
  }
}

function Row({
  row,
  mask,
  collapsed,
  onToggleCollapse,
  editing,
  onStartEdit,
  onCancelEdit,
  onCommit,
  onRename,
  onSetHidden,
}: {
  row: LedgerRow
  mask: boolean
  collapsed: boolean
  onToggleCollapse: (categoryId: string) => void
  editing: number | null
  onStartEdit: (index: number) => void
  onCancelEdit: () => void
  onCommit: (index: number, value: number | null, memo: string | null) => void
  onRename: (item: Item, name: string) => void
  onSetHidden: (item: Item, hidden: boolean) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const isAggregate = AGGREGATE.has(row.kind)
  const isDebtRow = row.category?.kind === 'DEBT' || row.kind === 'debtTotal'

  return (
    <tr className={`border-b ${rowStyle(row.kind)}`} style={{ borderColor: 'var(--line)' }}>
      <th
        scope="row"
        className={`sticky left-0 z-10 border-r px-3 py-2 text-left font-normal ${rowStyle(row.kind)} ${
          row.kind === 'group' || row.kind === 'item' ? '' : 'text-[13px]'
        }`}
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--card)' }}
      >
        <span className="group flex items-center gap-2">
          {row.kind === 'group' && row.category && (
            <button
              onClick={() => onToggleCollapse(row.category!.id)}
              aria-label={collapsed ? '펼치기' : '접기'}
              className="shrink-0 text-xs opacity-60 hover:opacity-100"
            >
              {collapsed ? '▸' : '▾'}
            </button>
          )}

          {row.kind === 'item' && <span className="w-3 shrink-0" />}

          {renaming && row.item ? (
            <input
              autoFocus
              defaultValue={row.label}
              onBlur={(event) => {
                onRename(row.item!, event.target.value)
                setRenaming(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') setRenaming(false)
              }}
              className="w-full rounded-md border bg-transparent px-2 py-1 text-sm"
              style={{ borderColor: 'var(--line)' }}
            />
          ) : (
            <span className={`min-w-0 flex-1 truncate ${row.item?.hidden ? 'opacity-40' : ''}`}>
              {row.label}
            </span>
          )}

          {row.kind === 'item' && row.item?.subCategory && (
            <span className="shrink-0 text-[10px] opacity-50">{row.item.subCategory}</span>
          )}

          {/* Without this the row would appear to be missing from the totals
              below it, with nothing on screen explaining why. */}
          {row.kind === 'item' && row.item?.countedElsewhere && (
            <span className="shrink-0" title={`합계 제외 — ${row.item.countedElsewhere}`}>
              <Badge tone="warn">합계 제외</Badge>
            </span>
          )}

          {row.kind === 'item' && row.item && !renaming && (
            <span className="ml-auto flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
              <button
                onClick={() => setRenaming(true)}
                aria-label="이름 수정"
                className="rounded p-1 text-xs hover:bg-[var(--surface)]"
              >
                ✎
              </button>
              <button
                onClick={() => onSetHidden(row.item!, !row.item!.hidden)}
                aria-label={row.item.hidden ? '숨김 해제' : '숨기기'}
                className="rounded p-1 text-xs hover:bg-[var(--surface)]"
              >
                {row.item.hidden ? '◉' : '◎'}
              </button>
            </span>
          )}
        </span>
      </th>

      {row.cells.map((cell, index) =>
        editing === index && !isAggregate ? (
          <td key={cell.ym} className="p-1">
            <CellEditor cell={cell} onCancel={onCancelEdit} onCommit={(value, memo) => onCommit(index, value, memo)} />
          </td>
        ) : (
          <td
            key={cell.ym}
            onClick={isAggregate ? undefined : () => onStartEdit(index)}
            className={`tnum relative whitespace-nowrap px-3 py-2 text-right ${
              isAggregate ? '' : 'cursor-pointer hover:bg-[var(--surface)]'
            }`}
          >
            {formatAmount(cell.value, { mask })}
            {cell.rate !== null && (
              <span className="block text-[10px] text-emerald-600 dark:text-emerald-400">
                {formatRate(cell.rate)}
              </span>
            )}
            {cell.memo && (
              <span
                title={cell.memo}
                className="absolute right-1 top-1 size-1.5 rounded-full bg-rose-500"
                aria-label={`메모: ${cell.memo}`}
              />
            )}
          </td>
        ),
      )}

      <td
        className={`tnum whitespace-nowrap border-l px-3 py-2 text-right ${
          row.yearChange === null
            ? ''
            : (row.yearChange > 0) !== isDebtRow
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-rose-600 dark:text-rose-400'
        }`}
        style={{ borderColor: 'var(--line)' }}
      >
        {formatChange(row.yearChange, { mask })}
      </td>
    </tr>
  )
}

/**
 * Amount and memo are edited together in one popover. The reference app put the
 * amount inline and the memo elsewhere, but a single tap target is what works on
 * touch, where hover affordances do not exist.
 */
function CellEditor({
  cell,
  onCancel,
  onCommit,
}: {
  cell: Cell
  onCancel: () => void
  onCommit: (value: number | null, memo: string | null) => void
}) {
  const [amount, setAmount] = useState(cell.value === null ? '' : String(cell.value))
  const [memo, setMemo] = useState(cell.memo ?? '')

  function submit() {
    onCommit(parseAmount(amount), memo.trim() === '' ? null : memo.trim())
  }

  return (
    <div
      className="flex min-w-[160px] flex-col gap-1 rounded-lg border bg-[var(--card)] p-1.5 shadow-lg"
      style={{ borderColor: 'var(--line)' }}
    >
      <input
        autoFocus
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit()
          if (event.key === 'Escape') onCancel()
        }}
        inputMode="numeric"
        placeholder="금액"
        className="tnum w-full rounded-md border bg-transparent px-2 py-1 text-right text-sm"
        style={{ borderColor: 'var(--line)' }}
      />
      <input
        value={memo}
        onChange={(event) => setMemo(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit()
          if (event.key === 'Escape') onCancel()
        }}
        placeholder="메모"
        className="w-full rounded-md border bg-transparent px-2 py-1 text-xs"
        style={{ borderColor: 'var(--line)' }}
      />
      <div className="flex gap-1">
        <button
          onClick={submit}
          className="flex-1 rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white"
        >
          저장
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border px-2 py-1 text-xs"
          style={{ borderColor: 'var(--line)' }}
        >
          취소
        </button>
      </div>
    </div>
  )
}
