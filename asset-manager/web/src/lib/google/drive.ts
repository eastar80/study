/**
 * Drive storage for the app's single data file.
 *
 * With the `drive.file` scope, `files.list` only ever returns files this app
 * created or the user explicitly picked — so listing is safe and narrow.
 */

import { getAccessToken } from './gis'

const FILES = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'

export const FOLDER_NAME = 'Asset Manager'
export const DATA_FILE_NAME = 'data.json'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

export interface DriveFileMeta {
  id: string
  name: string
  modifiedTime?: string
  headRevisionId?: string
}

async function driveFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken()
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(url, { ...init, headers })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(describeDriveError(response.status, body))
  }
  return response
}

function describeDriveError(status: number, body: string): string {
  if (status === 403 && body.includes('SERVICE_DISABLED')) {
    return 'Google Drive API가 켜져 있지 않습니다. 설정 안내 2단계를 확인하세요.'
  }
  if (status === 401) return '로그인이 만료되었습니다. 다시 로그인해 주세요.'
  return `Drive API 오류 (${status}): ${body.slice(0, 300)}`
}

async function findOne(query: string): Promise<DriveFileMeta | null> {
  const params = new URLSearchParams({
    q: query,
    fields: 'files(id,name,modifiedTime,headRevisionId)',
    pageSize: '10',
    spaces: 'drive',
  })
  const response = await driveFetch(`${FILES}?${params}`)
  const json = (await response.json()) as { files?: DriveFileMeta[] }
  return json.files?.[0] ?? null
}

async function ensureFolder(): Promise<string> {
  const existing = await findOne(`name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`)
  if (existing) return existing.id

  const response = await driveFetch(FILES + '?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
  })
  const json = (await response.json()) as { id: string }
  return json.id
}

export async function findDataFile(): Promise<DriveFileMeta | null> {
  return findOne(`name='${DATA_FILE_NAME}' and trashed=false and mimeType='application/json'`)
}

/** Multipart upload so metadata and content go in one request. */
async function uploadMultipart(
  fileId: string | null,
  metadata: Record<string, unknown>,
  content: string,
): Promise<DriveFileMeta> {
  const boundary = `am-${crypto.randomUUID()}`
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--\r\n`

  const url = fileId
    ? `${UPLOAD}/${fileId}?uploadType=multipart&fields=id,name,modifiedTime,headRevisionId`
    : `${UPLOAD}?uploadType=multipart&fields=id,name,modifiedTime,headRevisionId`

  const response = await driveFetch(url, {
    method: fileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  return (await response.json()) as DriveFileMeta
}

export interface LoadedData<T> {
  data: T
  meta: DriveFileMeta
}

export async function loadData<T>(): Promise<LoadedData<T> | null> {
  const file = await findDataFile()
  if (!file) return null

  const response = await driveFetch(`${FILES}/${file.id}?alt=media`)
  const text = await response.text()

  let data: T
  try {
    data = JSON.parse(text) as T
  } catch {
    throw new Error('Drive의 data.json 을 읽을 수 없습니다. 파일이 손상되었습니다.')
  }
  return { data, meta: file }
}

export class ConflictError extends Error {
  constructor(readonly remote: DriveFileMeta) {
    super('다른 기기에서 저장한 변경이 있습니다. 새로 불러온 뒤 다시 저장하세요.')
    this.name = 'ConflictError'
  }
}

/**
 * Writes the data file. When `expectedRevisionId` is given and Drive holds a
 * different revision, the write is refused instead of silently overwriting the
 * other device's changes.
 */
export async function saveData(
  data: unknown,
  expectedRevisionId?: string | null,
): Promise<DriveFileMeta> {
  const content = JSON.stringify(data, null, 2)
  const existing = await findDataFile()

  if (existing) {
    if (expectedRevisionId && existing.headRevisionId && existing.headRevisionId !== expectedRevisionId) {
      throw new ConflictError(existing)
    }
    return uploadMultipart(existing.id, { name: DATA_FILE_NAME }, content)
  }

  const folderId = await ensureFolder()
  return uploadMultipart(null, { name: DATA_FILE_NAME, parents: [folderId], mimeType: 'application/json' }, content)
}

/** Timestamped copy under the same folder, for the monthly backup. */
export async function saveBackup(data: unknown, label: string): Promise<DriveFileMeta> {
  const folderId = await ensureFolder()
  return uploadMultipart(
    null,
    { name: `backup-${label}.json`, parents: [folderId], mimeType: 'application/json' },
    JSON.stringify(data),
  )
}
