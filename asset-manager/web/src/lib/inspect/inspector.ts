/**
 * Reads a spreadsheet's shape and reports it.
 *
 * The point is to replace guesswork: merged cells, background colours and number
 * formats decide how a hand-made asset sheet expresses hierarchy and currency,
 * and none of that is visible in a screenshot.
 *
 * The report deliberately carries no amounts. Numeric cells contribute only
 * digit-length statistics, which are needed to tell an interest rate (1-2 digits)
 * from a balance (8-10 digits).
 */

import type { CellData, GridRange, Sheet, Spreadsheet } from '../google/sheets'
import { columnLetter, getSheetGrid, getSpreadsheetOutline } from '../google/sheets'
import {
  backgroundKey,
  classifyCell,
  detectTicker,
  integerDigits,
  isNumericKind,
  leadingIndent,
  parseMonthToken,
  type CellKind,
} from './patterns'
import type {
  ColumnProfile,
  GroupingFinding,
  InspectionReport,
  MonthAxisFinding,
  NumericShape,
  RowProfile,
  SheetNature,
  SheetReport,
  SkippedSheet,
} from './types'

// Ceilings, not fetch sizes: Sheets returns rowData only for rows that hold
// content and values only up to the last non-empty column, so a generous bound
// costs nothing on a sparse sheet. 80 columns previously truncated a ledger that
// runs months across the page.
const MAX_ROWS = 1000
const MAX_COLS = 300
const MAX_SAMPLE_ROWS = 8
const MAX_TEXT_SAMPLES = 6

const TOTAL_LABEL = /합계|소계|총계|총\s|계$|total/i
const RATE_LABEL = /금리|이자율|이율|rate/i
const FX_LABEL = /환율|기준환율|매매기준율|fx|exchange/i
const QTY_LABEL = /수량|주수|좌수|보유|qty|shares?/i
const PRICE_LABEL = /단가|평단|매입가|매수가|현재가|기준가|price|nav/i
const KRW_CONVERTED_LABEL = /원화|환산|krw환산|원화환산/i

function cellAt(rows: (CellData | undefined)[][], r: number, c: number): CellData | undefined {
  return rows[r]?.[c]
}

function textAt(rows: (CellData | undefined)[][], r: number, c: number): string | null {
  const value = cellAt(rows, r, c)?.formattedValue
  const text = value?.trim()
  return text ? text : null
}

/** Normalises the sparse rowData into a dense 2-D array of cells. */
function toGrid(sheet: Sheet, maxRows: number, maxCols: number): (CellData | undefined)[][] {
  const rowData = sheet.data?.[0]?.rowData ?? []
  const grid: (CellData | undefined)[][] = []
  for (let r = 0; r < Math.min(rowData.length, maxRows); r++) {
    const values = rowData[r]?.values ?? []
    const row: (CellData | undefined)[] = []
    for (let c = 0; c < Math.min(values.length, maxCols); c++) row.push(values[c])
    grid.push(row)
  }
  return grid
}

function width(grid: (CellData | undefined)[][]): number {
  return grid.reduce((max, row) => Math.max(max, row.length), 0)
}

/**
 * Finds the month axis by counting month tokens along every row and every
 * column, then taking whichever line has the most. A month header row in a
 * ledger yields a dozen or more hits, so the signal is unambiguous in practice.
 */
export function findMonthAxis(grid: (CellData | undefined)[][]): MonthAxisFinding {
  const cols = width(grid)
  let best: { axis: 'columns' | 'rows'; line: number; tokens: { ym: string | null; month: number | null }[] } | null =
    null

  const consider = (axis: 'columns' | 'rows', line: number, tokens: ReturnType<typeof parseMonthToken>[]) => {
    const hits = tokens.filter((t): t is NonNullable<typeof t> => t !== null)
    if (hits.length < 2) return
    if (!best || hits.length > best.tokens.length) best = { axis, line, tokens: hits }
  }

  for (let r = 0; r < grid.length; r++) {
    const tokens: ReturnType<typeof parseMonthToken>[] = []
    for (let c = 0; c < cols; c++) tokens.push(parseMonthToken(textAt(grid, r, c)))
    consider('columns', r, tokens)
  }

  for (let c = 0; c < cols; c++) {
    const tokens: ReturnType<typeof parseMonthToken>[] = []
    for (let r = 0; r < grid.length; r++) tokens.push(parseMonthToken(textAt(grid, r, c)))
    consider('rows', c, tokens)
  }

  if (!best) {
    return {
      axis: 'none',
      tokenCount: 0,
      months: [],
      firstYm: null,
      lastYm: null,
      yearMissing: false,
      gaps: [],
    }
  }

  // `best` is assigned inside the closure above; TS narrows it to never here.
  const found = best as { axis: 'columns' | 'rows'; line: number; tokens: { ym: string | null; month: number | null }[] }
  const months = found.tokens.map((t) => t.ym).filter((v): v is string => v !== null)
  const yearMissing = months.length === 0 && found.tokens.length > 0

  return {
    axis: found.axis,
    ...(found.axis === 'columns' ? { headerRowIndex: found.line } : { headerColumnIndex: found.line }),
    tokenCount: found.tokens.length,
    months,
    firstYm: months[0] ?? null,
    lastYm: months[months.length - 1] ?? null,
    yearMissing,
    gaps: findGaps(months),
  }
}

/** Missing months inside the observed range — a hole means an incomplete import. */
function findGaps(months: string[]): string[] {
  if (months.length < 2) return []
  const sorted = [...new Set(months)].sort()
  const gaps: string[] = []
  const parse = (ym: string) => {
    const [y, m] = ym.split('-')
    return Number(y) * 12 + Number(m) - 1
  }
  const format = (n: number) => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`

  let cursor = parse(sorted[0]!)
  const end = parse(sorted[sorted.length - 1]!)
  const present = new Set(sorted)
  for (; cursor <= end; cursor++) {
    const ym = format(cursor)
    if (!present.has(ym)) gaps.push(ym)
  }
  return gaps.slice(0, 24)
}

function mergesCovering(merges: GridRange[], row: number, col: number): boolean {
  return merges.some(
    (m) =>
      (m.startRowIndex ?? 0) <= row &&
      row < (m.endRowIndex ?? 0) &&
      (m.startColumnIndex ?? 0) <= col &&
      col < (m.endColumnIndex ?? 0),
  )
}

function profileColumns(
  grid: (CellData | undefined)[][],
  headerRowIndex: number | null,
  dataStartRow: number,
): ColumnProfile[] {
  const cols = width(grid)
  const profiles: ColumnProfile[] = []

  for (let c = 0; c < cols; c++) {
    const kindCounts = new Map<CellKind, number>()
    const currencyCounts = new Map<string, number>()
    let filled = 0
    let monthHits = 0
    let pattern: string | undefined
    const textSamples: string[] = []
    const tickerHits = { krx: 0, foreign: 0 }
    let minIntDigits = Infinity
    let maxIntDigits = 0
    let hasDecimals = false
    let anyNegative = false
    let numericCount = 0

    for (let r = dataStartRow; r < grid.length; r++) {
      const cell = cellAt(grid, r, c)
      const { kind, currency } = classifyCell(cell)
      if (kind === 'empty') continue

      filled++
      kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1)
      if (currency) currencyCounts.set(currency, (currencyCounts.get(currency) ?? 0) + 1)
      pattern ??= cell?.effectiveFormat?.numberFormat?.pattern

      const text = cell?.formattedValue?.trim() ?? ''
      if (parseMonthToken(text)) monthHits++

      if (isNumericKind(kind)) {
        const value = cell?.effectiveValue?.numberValue
        if (typeof value === 'number') {
          numericCount++
          const digits = integerDigits(value)
          minIntDigits = Math.min(minIntDigits, digits)
          maxIntDigits = Math.max(maxIntDigits, digits)
          if (!Number.isInteger(value)) hasDecimals = true
          if (value < 0) anyNegative = true
        }
      } else if (kind === 'text') {
        const ticker = detectTicker(text)
        if (ticker) tickerHits[ticker]++
        if (textSamples.length < MAX_TEXT_SAMPLES && !textSamples.includes(text)) {
          textSamples.push(text.slice(0, 40))
        }
      }
    }

    let dominant: CellKind = 'empty'
    let dominantCount = 0
    for (const [kind, count] of kindCounts) {
      if (count > dominantCount) {
        dominant = kind
        dominantCount = count
      }
    }

    const currency = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    const numericShape: NumericShape | undefined =
      numericCount > 0
        ? { minIntDigits: minIntDigits === Infinity ? 0 : minIntDigits, maxIntDigits, hasDecimals, anyNegative, count: numericCount }
        : undefined

    profiles.push({
      index: c,
      letter: columnLetter(c),
      header: headerRowIndex === null ? null : textAt(grid, headerRowIndex, c),
      kind: dominant,
      ...(currency ? { currency } : {}),
      ...(pattern ? { numberFormatPattern: pattern } : {}),
      filled,
      monthHits,
      ...(dominant === 'text' && textSamples.length > 0 ? { textSamples } : {}),
      ...(numericShape ? { numericShape } : {}),
      ...(tickerHits.krx + tickerHits.foreign > 0 ? { tickerHits } : {}),
    })
  }

  return profiles
}

function profileRows(
  grid: (CellData | undefined)[][],
  merges: GridRange[],
  labelColumn: number,
): RowProfile[] {
  const cols = width(grid)
  const rows: RowProfile[] = []

  for (let r = 0; r < grid.length; r++) {
    const cell = cellAt(grid, r, labelColumn)
    const raw = cell?.formattedValue ?? null
    const label = raw?.trim() || null

    let filledNumericCells = 0
    for (let c = labelColumn + 1; c < cols; c++) {
      if (isNumericKind(classifyCell(cellAt(grid, r, c)).kind)) filledNumericCells++
    }

    if (label === null && filledNumericCells === 0) continue

    rows.push({
      index: r,
      label,
      indent: leadingIndent(raw),
      bold: cell?.effectiveFormat?.textFormat?.bold === true,
      backgroundKey: backgroundKey(cell?.effectiveFormat),
      merged: mergesCovering(merges, r, labelColumn),
      filledNumericCells,
    })
  }

  return rows
}

function summariseGrouping(rows: RowProfile[], merges: GridRange[]): GroupingFinding {
  const backgrounds = new Map<string, number>()
  const indents = new Map<number, number>()
  let boldLabelRows = 0
  let mergedLabelCells = 0
  const totalRows: string[] = []

  for (const row of rows) {
    if (row.backgroundKey) backgrounds.set(row.backgroundKey, (backgrounds.get(row.backgroundKey) ?? 0) + 1)
    indents.set(row.indent, (indents.get(row.indent) ?? 0) + 1)
    if (row.bold) boldLabelRows++
    if (row.merged) mergedLabelCells++
    if (row.label && TOTAL_LABEL.test(row.label) && totalRows.length < 12) totalRows.push(row.label)
  }

  const distinctBackgrounds = [...backgrounds.entries()]
    .map(([key, count]) => ({ key, rows: count }))
    .sort((a, b) => b.rows - a.rows)
  const indentHistogram = [...indents.entries()]
    .map(([indent, count]) => ({ indent, rows: count }))
    .sort((a, b) => a.indent - b.indent)

  // Rank the signals by how strongly each one is actually present.
  let verdict: GroupingFinding['verdict'] = 'unclear'
  if (mergedLabelCells >= 2) verdict = 'merged-cells'
  else if (distinctBackgrounds.length >= 2) verdict = 'background-colour'
  else if (indentHistogram.length >= 2) verdict = 'indentation'
  else if (boldLabelRows >= 2) verdict = 'bold'

  return {
    mergeCount: merges.length,
    mergedLabelCells,
    distinctBackgrounds: distinctBackgrounds.slice(0, 8),
    boldLabelRows,
    indentHistogram,
    totalRows,
    verdict,
  }
}

function decideNature(
  monthAxis: MonthAxisFinding,
  columns: ColumnProfile[],
  labelColumns: number[],
): SheetNature {
  const headers = columns.map((c) => c.header ?? '').join(' | ')
  const hasDateColumn = columns.some((c) => c.kind === 'date' && c.filled >= 3)
  const tickerColumn = columns.find((c) => (c.tickerHits?.krx ?? 0) + (c.tickerHits?.foreign ?? 0) >= 3)
  const hasQty = QTY_LABEL.test(headers)
  const hasPrice = PRICE_LABEL.test(headers)

  if (monthAxis.axis === 'columns' && monthAxis.tokenCount >= 4 && labelColumns.length > 0) {
    return 'ledger-monthwise'
  }
  if (monthAxis.axis === 'rows' && monthAxis.tokenCount >= 4) return 'ledger-rowwise'

  if (tickerColumn || hasQty || hasPrice) {
    // Repeating tickers alongside a date column means a transaction log; one row
    // per ticker means a holdings snapshot.
    const samples = tickerColumn?.textSamples ?? []
    const repeats = samples.length !== new Set(samples).size
    return hasDateColumn && (repeats || hasDateColumn) ? 'transactions' : 'holdings'
  }

  if (columns.every((c) => c.kind === 'text' || c.kind === 'empty')) return 'reference'
  return 'unknown'
}

function redactRow(grid: (CellData | undefined)[][], r: number): string[] {
  const cols = width(grid)
  const out: string[] = []
  for (let c = 0; c < cols; c++) {
    const cell = cellAt(grid, r, c)
    const { kind, currency } = classifyCell(cell)
    switch (kind) {
      case 'empty':
        out.push('')
        break
      case 'currency':
        out.push(currency ? `<금액:${currency}>` : '<금액>')
        break
      case 'percent':
        out.push('<%>')
        break
      case 'number':
        out.push('<숫자>')
        break
      case 'date':
        out.push(cell?.formattedValue?.trim() ?? '<날짜>')
        break
      default:
        out.push((cell?.formattedValue ?? '').trim().slice(0, 40))
    }
  }
  // Trim trailing blanks so the sample stays readable.
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out
}

function analyseSheet(sheet: Sheet, maxRows: number, maxCols: number): SheetReport {
  const props = sheet.properties
  const grid = toGrid(sheet, maxRows, maxCols)
  const merges = sheet.merges ?? []
  const monthAxis = findMonthAxis(grid)

  const headerRowIndex = monthAxis.axis === 'columns' ? (monthAxis.headerRowIndex ?? null) : findTextHeaderRow(grid)
  const dataStartRow = headerRowIndex === null ? 0 : headerRowIndex + 1

  const columns = profileColumns(grid, headerRowIndex, dataStartRow)
  const labelColumns = columns
    .filter((c) => c.kind === 'text' && c.filled >= 3)
    .map((c) => c.index)
    .slice(0, 4)
  const labelColumn = labelColumns[0] ?? 0

  const rows = profileRows(grid, merges, labelColumn)
  const grouping = summariseGrouping(rows, merges)

  const currencies = [...new Set(columns.map((c) => c.currency).filter((v): v is string => Boolean(v)))]
  const percentCells = columns.reduce((sum, c) => sum + (c.kind === 'percent' ? c.filled : 0), 0)

  let noteCells = 0
  const noteSamples: string[] = []
  for (const row of grid) {
    for (const cell of row) {
      if (cell?.note) {
        noteCells++
        if (noteSamples.length < 5) noteSamples.push(cell.note.slice(0, 80))
      }
    }
  }

  const fxHints: string[] = []
  for (const column of columns) {
    const header = column.header ?? ''
    if (FX_LABEL.test(header)) fxHints.push(`${column.letter}열 "${header}" — 환율 컬럼으로 보임`)
    if (KRW_CONVERTED_LABEL.test(header)) fxHints.push(`${column.letter}열 "${header}" — 원화 환산 컬럼으로 보임`)
    if (RATE_LABEL.test(header)) fxHints.push(`${column.letter}열 "${header}" — 금리 컬럼으로 보임`)
  }
  for (const row of rows) {
    if (row.label && RATE_LABEL.test(row.label)) {
      fxHints.push(`${row.index + 1}행 "${row.label}" — 금리를 행으로 기록하는 방식으로 보임`)
      break
    }
  }

  const sampleRows: string[][] = []
  for (let r = dataStartRow; r < grid.length && sampleRows.length < MAX_SAMPLE_ROWS; r++) {
    const redacted = redactRow(grid, r)
    if (redacted.some((v) => v !== '')) sampleRows.push(redacted)
  }

  return {
    title: props.title,
    index: props.index,
    hidden: props.hidden === true,
    rowCount: props.gridProperties?.rowCount ?? grid.length,
    columnCount: props.gridProperties?.columnCount ?? width(grid),
    frozenRows: props.gridProperties?.frozenRowCount ?? 0,
    frozenColumns: props.gridProperties?.frozenColumnCount ?? 0,
    scannedRows: grid.length,
    scannedColumns: width(grid),
    truncated: (props.gridProperties?.rowCount ?? 0) > maxRows || (props.gridProperties?.columnCount ?? 0) > maxCols,
    headerRowIndex,
    monthAxis,
    labelColumns,
    columns: columns.filter((c) => c.filled > 0 || c.header !== null),
    rows: rows.slice(0, 120),
    grouping,
    currencies,
    percentCells,
    noteCells,
    noteSamples,
    fxHints: [...new Set(fxHints)],
    nature: decideNature(monthAxis, columns, labelColumns),
    redactedSamples: sampleRows,
  }
}

/** For sheets with no month header, the first row with several text cells. */
function findTextHeaderRow(grid: (CellData | undefined)[][]): number | null {
  const cols = width(grid)
  for (let r = 0; r < Math.min(grid.length, 20); r++) {
    let textCells = 0
    for (let c = 0; c < cols; c++) {
      if (classifyCell(cellAt(grid, r, c)).kind === 'text') textCells++
    }
    if (textCells >= 3) return r
  }
  return null
}

function collectWarnings(sheets: SheetReport[]): string[] {
  const warnings: string[] = []

  for (const sheet of sheets) {
    if (sheet.truncated) {
      warnings.push(
        `"${sheet.title}" 시트가 스캔 한도(${MAX_ROWS}행 × ${MAX_COLS}열)보다 큽니다. 실제 크기 ${sheet.rowCount}행 × ${sheet.columnCount}열 — 임포터에서는 전체를 읽습니다.`,
      )
    }
    if (sheet.monthAxis.yearMissing) {
      warnings.push(
        `"${sheet.title}" 시트의 월 헤더에 연도가 없습니다("7월" 형태). 연도를 어디서 가져올지 정해야 합니다.`,
      )
    }
    if (sheet.monthAxis.gaps.length > 0) {
      warnings.push(
        `"${sheet.title}" 시트의 월 헤더에 빠진 달이 있습니다: ${sheet.monthAxis.gaps.slice(0, 6).join(', ')}${sheet.monthAxis.gaps.length > 6 ? ' …' : ''}`,
      )
    }
    if (sheet.grouping.verdict === 'unclear' && sheet.nature.startsWith('ledger')) {
      warnings.push(`"${sheet.title}" 시트의 상위/하위 분류 표현 방식을 판별하지 못했습니다. 사람이 확인해야 합니다.`)
    }
    if (sheet.currencies.length > 1) {
      warnings.push(
        `"${sheet.title}" 시트에 통화가 섞여 있습니다(${sheet.currencies.join(', ')}). 항목별 통화 지정이 필요합니다.`,
      )
    }
  }

  if (!sheets.some((s) => s.nature === 'ledger-monthwise' || s.nature === 'ledger-rowwise')) {
    warnings.push('월별 자산 대장으로 보이는 시트를 찾지 못했습니다. 다른 파일을 고르셨는지 확인해 주세요.')
  }

  return warnings
}

export interface SheetSummary {
  title: string
  index: number
  sheetType: string
  rowCount: number
  columnCount: number
  hidden: boolean
  /** False for chart-only sheets, which hold no cells and cannot be analysed. */
  analysable: boolean
}

/**
 * Sheet list without any cell data — cheap enough to call before deciding what
 * to analyse.
 */
export async function listSheets(spreadsheetId: string): Promise<SheetSummary[]> {
  const outline = await getSpreadsheetOutline(spreadsheetId)
  return (outline.sheets ?? []).map((sheet) => {
    const props = sheet.properties
    const sheetType = props.sheetType ?? 'GRID'
    const rowCount = props.gridProperties?.rowCount ?? 0
    const columnCount = props.gridProperties?.columnCount ?? 0
    return {
      title: props.title,
      index: props.index,
      sheetType,
      rowCount,
      columnCount,
      hidden: props.hidden === true,
      analysable: sheetType === 'GRID' && rowCount > 0 && columnCount > 0,
    }
  })
}

/** Sheet names worth analysing by default, from the workbooks in use. */
const LIKELY_SOURCE = /잔액|보유현황|기준가|입력정보|포트폴리오/

export function defaultSelection(sheets: SheetSummary[]): string[] {
  const likely = sheets.filter((s) => s.analysable && LIKELY_SOURCE.test(s.title))
  // Fall back to everything readable rather than pre-selecting nothing.
  return (likely.length > 0 ? likely : sheets.filter((s) => s.analysable)).map((s) => s.title)
}

export interface InspectOptions {
  /** Analyse only these sheets. Omit for all of them. */
  titles?: string[]
}

/**
 * Reads the requested sheets and builds the report.
 *
 * A single unreadable sheet must not sink the whole run: a real workbook tends
 * to carry chart-only sheets and leftovers alongside the ledger, and the ledger
 * is what matters. Failures are collected per sheet and reported.
 */
export async function inspectSpreadsheet(
  spreadsheetId: string,
  options?: InspectOptions,
  onProgress?: (message: string) => void,
): Promise<InspectionReport> {
  onProgress?.('시트 목록을 읽는 중…')
  const outline = await getSpreadsheetOutline(spreadsheetId)
  const sheetProps = (outline.sheets ?? []).map((s) => s.properties)

  const requested = options?.titles ? new Set(options.titles) : null
  const reports: SheetReport[] = []
  const skipped: SkippedSheet[] = []

  for (let i = 0; i < sheetProps.length; i++) {
    const props = sheetProps[i]!

    if (requested && !requested.has(props.title)) {
      skipped.push({ title: props.title, reason: '분석 대상으로 선택하지 않았습니다.' })
      continue
    }

    onProgress?.(`"${props.title}" 구조 분석 중… (${reports.length + 1}/${requested?.size ?? sheetProps.length})`)

    // Chart-only sheets ('OBJECT') have no cells at all, so any A1 range is
    // invalid and Sheets answers 400.
    if (props.sheetType && props.sheetType !== 'GRID') {
      skipped.push({ title: props.title, reason: `셀이 없는 시트입니다 (${props.sheetType}, 차트 전용).` })
      continue
    }
    if (!props.gridProperties?.rowCount || !props.gridProperties?.columnCount) {
      skipped.push({ title: props.title, reason: '격자 크기 정보가 없어 읽을 범위를 정할 수 없습니다.' })
      continue
    }

    const rows = Math.min(props.gridProperties.rowCount, MAX_ROWS)
    const cols = Math.min(props.gridProperties.columnCount, MAX_COLS)

    try {
      const grid: Spreadsheet = await getSheetGrid(spreadsheetId, props.title, rows, cols)
      const sheet = grid.sheets?.[0]
      if (!sheet) {
        skipped.push({ title: props.title, reason: '응답에 셀 데이터가 없습니다.' })
        continue
      }

      // The ranged read returns properties for the requested sheet only, but the
      // outline carries the authoritative dimensions.
      reports.push(analyseSheet({ ...sheet, properties: { ...props, ...sheet.properties } }, rows, cols))
    } catch (cause) {
      skipped.push({
        title: props.title,
        reason: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  return {
    generatedAtIso: new Date().toISOString(),
    spreadsheetTitle: outline.properties?.title ?? '(제목 없음)',
    locale: outline.properties?.locale ?? null,
    sheetCount: reports.length,
    sheets: reports,
    skipped,
    requestedTitles: options?.titles ?? null,
    warnings: collectWarnings(reports),
  }
}
