/**
 * Google Picker — the only way to reach an existing spreadsheet while holding
 * just the `drive.file` scope. Picking a file is what grants access to it.
 */

import { getApiKey, getProjectNumber } from '../../config'
import { getAccessToken } from './gis'
import { loadScript } from './loadScript'

export interface PickedFile {
  id: string
  name: string
  mimeType: string
}

interface PickerDoc {
  id: string
  name: string
  mimeType: string
}

interface PickerResult {
  action: string
  docs?: PickerDoc[]
}

async function ensurePicker(): Promise<void> {
  await loadScript('https://apis.google.com/js/api.js', () => Boolean(window.gapi?.load))
  if (window.google?.picker) return

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Picker 초기화 시간이 초과되었습니다.')), 15_000)
    window.gapi!.load('picker', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/** Native Google Sheets — the only type the Sheets API can read. */
export const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet'

/**
 * Opens the picker for spreadsheets and resolves with the chosen file, or null
 * when the user cancels.
 *
 * `setAppId` is required, not optional: under the `drive.file` scope the grant
 * the picker creates is only attached to this app when the Cloud project number
 * is supplied. Without it the picker still returns a file, but every subsequent
 * Drive/Sheets call on that file fails with 404.
 */
export async function pickSpreadsheet(): Promise<PickedFile | null> {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('API 키가 설정되지 않았습니다.')

  const projectNumber = getProjectNumber()
  if (!projectNumber) {
    throw new Error(
      '클라이언트 ID에서 프로젝트 번호를 읽을 수 없습니다. 환경 설정에서 클라이언트 ID가 온전한지 확인하세요.',
    )
  }

  const token = await getAccessToken()
  await ensurePicker()

  const picker = window.google?.picker
  if (!picker) throw new Error('Picker를 초기화할 수 없습니다.')

  return new Promise<PickedFile | null>((resolve) => {
    const view = new picker.DocsView(picker.ViewId.SPREADSHEETS)
    view.setIncludeFolders(true)
    view.setSelectFolderEnabled(false)

    const builder = new picker.PickerBuilder()
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setAppId(projectNumber)
      .setTitle('자산 시트 선택')
      .setLocale('ko')
      .addView(view)
      .setCallback((result: PickerResult) => {
        if (result.action === picker.Action.PICKED) {
          const doc = result.docs?.[0]
          resolve(doc ? { id: doc.id, name: doc.name, mimeType: doc.mimeType } : null)
        } else if (result.action === picker.Action.CANCEL) {
          resolve(null)
        }
      })

    builder.build().setVisible(true)
  })
}

/**
 * Explains why a picked file cannot be inspected, or null when it can.
 *
 * The picker's spreadsheet view also lists uploaded Excel files, and the Sheets
 * API answers 404 for those — indistinguishable from a permissions failure — so
 * the type is checked before any request goes out.
 */
export function describeUnsupportedFile(file: PickedFile): string | null {
  if (file.mimeType === GOOGLE_SHEET_MIME) return null

  const isExcel =
    file.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.mimeType === 'application/vnd.ms-excel' ||
    file.mimeType === 'application/vnd.oasis.opendocument.spreadsheet'

  if (isExcel) {
    return (
      `"${file.name}" 은 Google 스프레드시트가 아니라 Drive에 올려둔 Excel 파일입니다. ` +
      'Google Sheets API는 Excel 파일을 읽지 못합니다. ' +
      'Drive에서 이 파일을 열고 [파일 > Google Sheets로 저장]을 누르면 변환본이 새로 만들어집니다 ' +
      '(원본은 그대로 남습니다). 그 변환본을 다시 골라 주세요.'
    )
  }

  if (file.mimeType === 'text/csv') {
    return (
      `"${file.name}" 은 CSV 파일입니다. CSV에는 병합 셀·배경색·숫자 서식이 없어 구조를 판별할 수 없습니다. ` +
      'Drive에서 Google 스프레드시트로 변환한 뒤 다시 골라 주세요.'
    )
  }

  return `"${file.name}" 의 형식(${file.mimeType})은 읽을 수 없습니다. Google 스프레드시트를 골라 주세요.`
}
