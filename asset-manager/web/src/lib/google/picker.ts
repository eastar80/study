/**
 * Google Picker — the only way to reach an existing spreadsheet while holding
 * just the `drive.file` scope. Picking a file is what grants access to it.
 */

import { getApiKey } from '../../config'
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

/**
 * Opens the picker restricted to Google Sheets and resolves with the chosen
 * file, or null when the user cancels.
 */
export async function pickSpreadsheet(): Promise<PickedFile | null> {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('API 키가 설정되지 않았습니다.')

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
      .setTitle('자산 시트 선택')
      .setLocale('ko')
      .addView(view)
      .addView(new picker.DocsView(picker.ViewId.SPREADSHEETS).setStarred(true))
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
