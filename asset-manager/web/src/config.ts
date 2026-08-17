/**
 * Google OAuth client ID and API key.
 *
 * Both are public browser-visible identifiers, not secrets — they are locked to
 * this site by the "authorized JavaScript origins" and API-key referrer
 * restrictions described in docs/04-google-설정.md.
 *
 * Resolution order:
 *   1. build-time env (VITE_GOOGLE_CLIENT_ID / VITE_GOOGLE_API_KEY)
 *   2. values the user pasted into the app, kept in localStorage
 *
 * The localStorage path exists so the credentials can be entered from a tablet
 * without a rebuild.
 */

const LS_CLIENT_ID = 'am.google.clientId'
const LS_API_KEY = 'am.google.apiKey'

/** The only scope this app ever requests. */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

function envValue(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  // Vite substitutes missing env vars with an empty string; guard against the
  // placeholder text being left in a .env file too.
  return value.startsWith('<') ? '' : value
}

export function getClientId(): string {
  return (
    envValue(import.meta.env.VITE_GOOGLE_CLIENT_ID) ||
    localStorage.getItem(LS_CLIENT_ID)?.trim() ||
    ''
  )
}

export function getApiKey(): string {
  return (
    envValue(import.meta.env.VITE_GOOGLE_API_KEY) ||
    localStorage.getItem(LS_API_KEY)?.trim() ||
    ''
  )
}

/**
 * Cloud project number, needed by the Picker so the file grant it creates is
 * attached to this app. It is the leading digit group of the OAuth client ID
 * (`123456789012-xxxxx.apps.googleusercontent.com`), so there is nothing extra
 * for the user to look up. Returns '' when the client ID is not in that shape.
 */
export function getProjectNumber(clientId: string = getClientId()): string {
  const match = /^(\d+)-/.exec(clientId.trim())
  return match ? match[1]! : ''
}

export function setCredentials(clientId: string, apiKey: string): void {
  localStorage.setItem(LS_CLIENT_ID, clientId.trim())
  localStorage.setItem(LS_API_KEY, apiKey.trim())
}

export function clearCredentials(): void {
  localStorage.removeItem(LS_CLIENT_ID)
  localStorage.removeItem(LS_API_KEY)
}

export function hasCredentials(): boolean {
  return getClientId() !== '' && getApiKey() !== ''
}

/** Sanity checks that catch the two mistakes people actually make. */
export function describeCredentialProblem(clientId: string, apiKey: string): string | null {
  if (!clientId) return '클라이언트 ID를 입력하세요.'
  if (!clientId.endsWith('.apps.googleusercontent.com')) {
    return '클라이언트 ID는 ".apps.googleusercontent.com" 으로 끝나야 합니다. API 키와 바뀌지 않았는지 확인하세요.'
  }
  if (!apiKey) return 'API 키를 입력하세요.'
  if (apiKey.endsWith('.apps.googleusercontent.com')) {
    return 'API 키 자리에 클라이언트 ID가 들어갔습니다. 두 값이 바뀌었습니다.'
  }
  if (!apiKey.startsWith('AIza')) {
    return 'API 키는 보통 "AIza" 로 시작합니다. 값을 다시 확인하세요.'
  }
  if (!getProjectNumber(clientId)) {
    return '클라이언트 ID 앞부분에서 프로젝트 번호(숫자)를 찾을 수 없습니다. 값이 잘렸는지 확인하세요.'
  }
  return null
}
