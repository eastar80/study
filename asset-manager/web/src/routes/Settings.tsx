import { useState } from 'react'
import {
  clearCredentials,
  describeCredentialProblem,
  describeProxyProblem,
  getApiKey,
  getClientId,
  getQuoteProxyUrl,
  setCredentials,
  setQuoteProxyUrl,
} from '../config'
import type { Vault } from '../state/useVault'
import { Alert, Button, Card, Field, Muted, TextInput } from '../ui/primitives'

const STATUS_TEXT: Record<Vault['status'], string> = {
  idle: '대기',
  loading: '불러오는 중…',
  saving: '저장 중…',
  saved: '저장 완료',
  offline: '오프라인 — 이 기기에만 보관',
  conflict: '충돌 — 다른 기기의 변경이 있습니다',
  error: '오류',
}

export function Settings({
  signedIn,
  authBusy,
  authError,
  onConnect,
  onDisconnect,
  vault,
}: {
  signedIn: boolean
  authBusy: boolean
  authError: string | null
  onConnect: () => void
  onDisconnect: () => void
  vault: Vault
}) {
  const [clientId, setClientId] = useState(getClientId)
  const [apiKey, setApiKey] = useState(getApiKey)
  const [saved, setSaved] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const [proxyUrl, setProxyUrl] = useState(getQuoteProxyUrl)
  const [proxySaved, setProxySaved] = useState(false)
  const [proxyProblem, setProxyProblem] = useState<string | null>(null)

  function save() {
    const issue = describeCredentialProblem(clientId.trim(), apiKey.trim())
    setProblem(issue)
    if (issue) return
    setCredentials(clientId, apiKey)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  function saveProxy() {
    const issue = describeProxyProblem(proxyUrl)
    setProxyProblem(issue)
    if (issue) return
    setQuoteProxyUrl(proxyUrl)
    setProxySaved(true)
    setTimeout(() => setProxySaved(false), 3000)
  }

  function reset() {
    clearCredentials()
    setClientId('')
    setApiKey('')
    setProblem(null)
  }

  return (
    <div className="space-y-5">
      <Card title="Google 연동">
        <div className="space-y-4">
          <Muted>
            아래 두 값은 브라우저에 노출되는 <strong>공개 식별자</strong>입니다. 비밀번호가 아니며,
            Google Cloud 콘솔에서 이 사이트 주소로만 쓰이도록 제한해 두면 남이 가져다 쓸 수 없습니다.
            발급 방법은 저장소의 <code>docs/04-google-설정.md</code> 에 있습니다.
          </Muted>

          <Field
            label="OAuth 클라이언트 ID"
            hint="…apps.googleusercontent.com 으로 끝납니다."
          >
            <TextInput
              value={clientId}
              onChange={setClientId}
              placeholder="123456789012-xxxxx.apps.googleusercontent.com"
              mono
            />
          </Field>

          <Field label="API 키" hint="Picker 창을 띄우는 데 쓰입니다. 보통 AIza 로 시작합니다.">
            <TextInput value={apiKey} onChange={setApiKey} placeholder="AIza…" mono />
          </Field>

          {problem && <Alert tone="error">{problem}</Alert>}
          {saved && <Alert tone="info">저장했습니다. 이제 아래에서 Drive에 연결하세요.</Alert>}

          <div className="flex flex-wrap gap-2">
            <Button onClick={save}>저장</Button>
            <Button variant="ghost" onClick={reset}>
              지우기
            </Button>
          </div>
        </div>
      </Card>

      <Card title="시세·환율 프록시">
        <div className="space-y-4">
          <Muted>
            브라우저는 CORS 때문에 시세 사이트를 직접 부를 수 없어 중계가 하나 필요합니다. 배포 절차는{' '}
            <code>docs/07-시세-프록시.md</code> 에 있습니다. 이 주소로는 <strong>종목 심볼만</strong>{' '}
            오갑니다 — 보유 수량이나 금액은 가지 않습니다.
          </Muted>

          <Field
            label="Apps Script 웹 앱 주소"
            hint='"/exec" 로 끝나는 주소입니다. "/dev" 는 편집자만 열 수 있어 앱에서는 동작하지 않습니다.'
          >
            <TextInput
              value={proxyUrl}
              onChange={setProxyUrl}
              placeholder="https://script.google.com/macros/s/…/exec"
              mono
            />
          </Field>

          {proxyProblem && <Alert tone="error">{proxyProblem}</Alert>}
          {proxySaved && <Alert tone="info">저장했습니다. 포트폴리오에서 시세를 불러올 수 있습니다.</Alert>}

          <div className="flex gap-2">
            <Button onClick={saveProxy}>저장</Button>
            <Button
              variant="ghost"
              onClick={() => {
                setQuoteProxyUrl('')
                setProxyUrl('')
                setProxyProblem(null)
              }}
            >
              지우기
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Drive 연결 상태">
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <dt className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                로그인
              </dt>
              <dd className="font-medium">{signedIn ? '연결됨' : '연결 안 됨'}</dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                동기화
              </dt>
              <dd className="font-medium">
                {STATUS_TEXT[vault.status]}
                {vault.dirty && ' · 저장 대기 중'}
              </dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                마지막 동기화
              </dt>
              <dd className="font-medium">
                {vault.lastSyncedIso ? new Date(vault.lastSyncedIso).toLocaleString('ko-KR') : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                저장 위치
              </dt>
              <dd className="font-mono text-xs">/Asset Manager/data.json</dd>
            </div>
          </dl>

          {authError && <Alert tone="error">{authError}</Alert>}
          {vault.message && (
            <Alert tone={vault.status === 'error' || vault.status === 'conflict' ? 'error' : 'info'}>
              {vault.message}
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            {signedIn ? (
              <>
                <Button onClick={() => void vault.pullFromDrive()}>Drive에서 불러오기</Button>
                <Button variant="ghost" onClick={() => void vault.pushToDrive()}>
                  지금 저장
                </Button>
                <Button variant="danger" onClick={onDisconnect}>
                  연결 해제
                </Button>
              </>
            ) : (
              <Button onClick={onConnect} disabled={authBusy}>
                {authBusy ? '연결 중…' : 'Google Drive 연결'}
              </Button>
            )}
          </div>

          <Muted>
            요청하는 권한은 <code>drive.file</code> 하나뿐입니다. 이 앱이 만든 파일과 내가 직접 고른
            파일 외에는 Drive의 어떤 것도 볼 수 없습니다.
          </Muted>
        </div>
      </Card>
    </div>
  )
}
