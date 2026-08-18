import type { ReactNode } from 'react'
import { getSheetGrid, type Sheet } from '../lib/google/sheets'

/** Wide enough for the observed sheets (59 and 26 columns) with room to grow. */
export const READ_ROWS = 1000
export const READ_COLS = 300

export const won = new Intl.NumberFormat('ko-KR')

export async function readSheet(spreadsheetId: string, title: string): Promise<Sheet> {
  const response = await getSheetGrid(spreadsheetId, title, READ_ROWS, READ_COLS)
  const sheet = response.sheets?.[0]
  if (!sheet) throw new Error(`"${title}" 시트를 읽지 못했습니다.`)
  return sheet
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>
      {children}
    </h3>
  )
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </dt>
      <dd className="tnum font-medium">{value}</dd>
    </div>
  )
}
