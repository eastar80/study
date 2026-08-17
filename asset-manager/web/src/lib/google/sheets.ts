/**
 * Minimal Sheets API v4 client — reads structure and formatting, which is what
 * the inspector needs and what a screenshot cannot show.
 *
 * The Sheets API accepts the `drive.file` scope for files the user picked, so no
 * broader Drive scope is needed.
 */

import { getAccessToken } from './gis'

const API = 'https://sheets.googleapis.com/v4/spreadsheets'

export interface NumberFormat {
  type?: string
  pattern?: string
}

export interface CellFormat {
  numberFormat?: NumberFormat
  backgroundColor?: { red?: number; green?: number; blue?: number }
  textFormat?: { bold?: boolean }
  horizontalAlignment?: string
}

export interface CellData {
  formattedValue?: string
  effectiveFormat?: CellFormat
  effectiveValue?: { stringValue?: string; numberValue?: number; boolValue?: boolean }
  note?: string
}

export interface RowData {
  values?: CellData[]
}

export interface GridRange {
  sheetId?: number
  startRowIndex?: number
  endRowIndex?: number
  startColumnIndex?: number
  endColumnIndex?: number
}

export interface SheetProperties {
  sheetId: number
  title: string
  index: number
  gridProperties?: {
    rowCount?: number
    columnCount?: number
    frozenRowCount?: number
    frozenColumnCount?: number
  }
  hidden?: boolean
}

export interface Sheet {
  properties: SheetProperties
  merges?: GridRange[]
  data?: { rowData?: RowData[] }[]
}

export interface Spreadsheet {
  spreadsheetId: string
  properties?: { title?: string; locale?: string; timeZone?: string }
  sheets?: Sheet[]
}

async function request<T>(url: string): Promise<T> {
  const token = await getAccessToken()
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(describeSheetsError(response.status, body))
  }
  return (await response.json()) as T
}

function describeSheetsError(status: number, body: string): string {
  if (status === 403 && body.includes('SERVICE_DISABLED')) {
    return 'Google Sheets API가 켜져 있지 않습니다. 설정 안내 2단계를 확인하세요.'
  }
  if (status === 403) {
    return '이 시트에 접근할 권한이 없습니다. 파일 선택 창에서 다시 골라 주세요.'
  }
  if (status === 404) {
    // Sheets answers 404 both for "no access" and for "not a native Google
    // Sheet", so name both causes rather than sending the user to the wrong one.
    return (
      'Sheets API가 이 파일을 찾지 못했습니다 (404). 원인은 보통 둘 중 하나입니다. ' +
      '① 고른 파일이 Google 스프레드시트가 아니라 Drive에 올려둔 Excel 파일이다 — Drive에서 ' +
      '[파일 > Google Sheets로 저장]으로 변환한 뒤 다시 고르세요. ' +
      '② 파일 선택 권한이 앱에 전달되지 않았다 — 파일 선택 창에서 다시 골라 보세요.'
    )
  }
  return `Sheets API 오류 (${status}): ${body.slice(0, 300)}`
}

/** Sheet list and dimensions, without any cell data. */
export function getSpreadsheetOutline(spreadsheetId: string): Promise<Spreadsheet> {
  const fields = encodeURIComponent('spreadsheetId,properties(title,locale,timeZone),sheets(properties)')
  return request<Spreadsheet>(`${API}/${spreadsheetId}?fields=${fields}`)
}

/** Column index (0-based) to spreadsheet letters. */
export function columnLetter(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function quoteTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`
}

/**
 * Cell values plus the formatting the inspector reasons about, bounded to a
 * window so a decade-long sheet does not pull megabytes.
 */
export function getSheetGrid(
  spreadsheetId: string,
  title: string,
  maxRows: number,
  maxCols: number,
): Promise<Spreadsheet> {
  const range = encodeURIComponent(`${quoteTitle(title)}!A1:${columnLetter(maxCols - 1)}${maxRows}`)
  const fields = encodeURIComponent(
    'sheets(properties,merges,data(rowData(values(formattedValue,note,effectiveValue,effectiveFormat(numberFormat,backgroundColor,textFormat,horizontalAlignment)))))',
  )
  return request<Spreadsheet>(
    `${API}/${spreadsheetId}?ranges=${range}&includeGridData=true&fields=${fields}`,
  )
}
