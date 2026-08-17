/**
 * Single declaration site for the globals Google's loaders attach.
 *
 * Only the members this app calls are typed. The Picker namespace is declared
 * loosely because its builder is a long fluent chain whose full surface is not
 * worth mirroring.
 */

interface GoogleTokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface GoogleTokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string
    scope: string
    callback: (response: GoogleTokenResponse) => void
    error_callback?: (error: { type?: string; message?: string }) => void
  }): GoogleTokenClient
  revoke(token: string, done?: () => void): void
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface GooglePickerNamespace {
  ViewId: Record<string, string>
  Action: { PICKED: string; CANCEL: string }
  DocsView: new (viewId?: string) => any
  PickerBuilder: new () => any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

interface GoogleNamespace {
  accounts?: { oauth2: GoogleOAuth2 }
  picker?: GooglePickerNamespace
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface Window {
  google?: GoogleNamespace
  gapi?: { load(name: string, callback: () => void): void }
}
