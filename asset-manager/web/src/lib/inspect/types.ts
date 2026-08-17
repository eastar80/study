import type { CellKind } from './patterns'

export interface NumericShape {
  minIntDigits: number
  maxIntDigits: number
  hasDecimals: boolean
  anyNegative: boolean
  count: number
}

export interface ColumnProfile {
  index: number
  letter: string
  /** Text found in the detected header row, if any. */
  header: string | null
  kind: CellKind
  currency?: string
  numberFormatPattern?: string
  filled: number
  monthHits: number
  /** Only populated for text columns — never contains amounts. */
  textSamples?: string[]
  numericShape?: NumericShape
  tickerHits?: { krx: number; foreign: number }
}

export interface RowProfile {
  index: number
  label: string | null
  indent: number
  bold: boolean
  backgroundKey: string | null
  merged: boolean
  filledNumericCells: number
}

export interface MonthAxisFinding {
  axis: 'columns' | 'rows' | 'none'
  /** Row index (0-based) holding the month headers when axis === 'columns'. */
  headerRowIndex?: number
  /** Column index (0-based) holding the month headers when axis === 'rows'. */
  headerColumnIndex?: number
  tokenCount: number
  /** Months resolved to YYYY-MM, in sheet order. */
  months: string[]
  firstYm: string | null
  lastYm: string | null
  /** True when the header names months without a year (e.g. "7월"). */
  yearMissing: boolean
  gaps: string[]
}

export interface GroupingFinding {
  mergeCount: number
  mergedLabelCells: number
  distinctBackgrounds: { key: string; rows: number }[]
  boldLabelRows: number
  indentHistogram: { indent: number; rows: number }[]
  /** Rows whose label looks like a total ("합계", "소계", "총"). */
  totalRows: string[]
  verdict: 'merged-cells' | 'background-colour' | 'indentation' | 'bold' | 'separate-column' | 'unclear'
}

export type SheetNature =
  | 'ledger-monthwise'
  | 'ledger-rowwise'
  | 'holdings'
  | 'transactions'
  | 'reference'
  | 'unknown'

export interface SheetReport {
  title: string
  index: number
  hidden: boolean
  rowCount: number
  columnCount: number
  frozenRows: number
  frozenColumns: number
  scannedRows: number
  scannedColumns: number
  truncated: boolean
  headerRowIndex: number | null
  monthAxis: MonthAxisFinding
  labelColumns: number[]
  columns: ColumnProfile[]
  rows: RowProfile[]
  grouping: GroupingFinding
  currencies: string[]
  percentCells: number
  /** Cell notes — the equivalent of the original app's per-cell memo. */
  noteCells: number
  noteSamples: string[]
  fxHints: string[]
  nature: SheetNature
  /** Text-only sample rows; every numeric cell is replaced by a placeholder. */
  redactedSamples: string[][]
}

export interface SkippedSheet {
  title: string
  reason: string
}

export interface InspectionReport {
  generatedAtIso: string
  spreadsheetTitle: string
  locale: string | null
  sheetCount: number
  sheets: SheetReport[]
  /** Sheets that were not analysed, and why — never dropped silently. */
  skipped: SkippedSheet[]
  /** Titles the run was limited to, or null when every sheet was attempted. */
  requestedTitles: string[] | null
  /** Notes for a human reader — ambiguities the inspector could not settle. */
  warnings: string[]
}
