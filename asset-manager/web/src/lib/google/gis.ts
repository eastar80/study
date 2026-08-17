/**
 * Google Identity Services token client.
 *
 * Uses the implicit token flow: a popup returns a short-lived access token that
 * lives in memory only. Nothing is persisted, so closing the tab drops the
 * token and there is no refresh token to leak.
 */

import { DRIVE_FILE_SCOPE, getClientId } from '../../config'
import { loadScript } from './loadScript'

type TokenResponse = GoogleTokenResponse
type TokenClient = GoogleTokenClient

let tokenClient: TokenClient | null = null
let accessToken: string | null = null
let expiresAt = 0
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null

const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export function onAuthChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isSignedIn(): boolean {
  return accessToken !== null && Date.now() < expiresAt
}

/** Token for direct fetch() calls. Null when not signed in. */
export function currentToken(): string | null {
  return isSignedIn() ? accessToken : null
}

async function ensureTokenClient(): Promise<TokenClient> {
  if (tokenClient) return tokenClient

  const clientId = getClientId()
  if (!clientId) throw new Error('클라이언트 ID가 설정되지 않았습니다.')

  await loadScript('https://accounts.google.com/gsi/client', () => Boolean(window.google?.accounts))

  const oauth2 = window.google?.accounts?.oauth2
  if (!oauth2) throw new Error('Google 로그인 스크립트를 초기화할 수 없습니다.')

  tokenClient = oauth2.initTokenClient({
    client_id: clientId,
    scope: DRIVE_FILE_SCOPE,
    callback: (response) => {
      const settle = pending
      pending = null

      if (response.error || !response.access_token) {
        accessToken = null
        expiresAt = 0
        notify()
        settle?.reject(new Error(describeTokenError(response)))
        return
      }

      accessToken = response.access_token
      // Renew a minute early so a long save does not straddle the expiry.
      expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000 - 60_000
      notify()
      settle?.resolve(accessToken)
    },
    error_callback: (error) => {
      const settle = pending
      pending = null
      settle?.reject(new Error(error.message || '로그인 창이 닫혔습니다.'))
    },
  })

  return tokenClient
}

function describeTokenError(response: TokenResponse): string {
  if (response.error === 'access_denied') {
    return '접근이 거부되었습니다. Google Cloud 콘솔의 OAuth 동의 화면에서 "테스트 사용자"에 내 계정이 추가되어 있는지 확인하세요. (설정 안내 3-④)'
  }
  return response.error_description || response.error || '알 수 없는 인증 오류'
}

/**
 * Returns a valid access token, prompting the user only when necessary.
 * `interactive: false` attempts a silent renewal and is what callers should use
 * on a token that merely expired.
 */
export async function getAccessToken(options?: { interactive?: boolean }): Promise<string> {
  if (isSignedIn()) return accessToken!

  const client = await ensureTokenClient()
  if (pending) throw new Error('이미 로그인 요청이 진행 중입니다.')

  return new Promise<string>((resolve, reject) => {
    pending = { resolve, reject }
    // An empty prompt reuses an existing Google session without a consent
    // screen; 'consent' forces the picker + permission screen.
    client.requestAccessToken({ prompt: options?.interactive === false ? '' : '' })
  })
}

/** Explicit sign-in from a user gesture. */
export function signIn(): Promise<string> {
  return getAccessToken({ interactive: true })
}

export function signOut(): void {
  const token = accessToken
  accessToken = null
  expiresAt = 0
  notify()
  if (token && window.google?.accounts) {
    window.google.accounts.oauth2.revoke(token)
  }
}
