import { useEffect, useState } from 'react'
import { Sidebar } from './ui/Sidebar'
import { useRoute, type Route } from './ui/hashRoute'
import { Card, Muted } from './ui/primitives'
import { Dashboard } from './routes/Dashboard'
import { Import } from './routes/Import'
import { Ledger } from './routes/Ledger'
import { Inspect } from './routes/Inspect'
import { Settings } from './routes/Settings'
import { useAuth } from './state/useAuth'
import { useVault } from './state/useVault'

const TITLES: Record<Route, string> = {
  dashboard: '대시보드',
  ledger: '자산 관리',
  portfolio: '포트폴리오',
  timeline: '타임라인',
  import: '가져오기',
  inspect: '시트 분석',
  settings: '환경 설정',
}

const PENDING: Partial<Record<Route, string>> = {
  portfolio: '자산 대장과 대시보드를 실제로 써 본 뒤에 만듭니다. 시세·환율 중계용 프록시가 함께 필요합니다.',
  timeline: '마지막 단계에서 만듭니다.',
}

export default function App() {
  const [route, navigate] = useRoute()
  const auth = useAuth()
  const vault = useVault(auth.signedIn)
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 1280)

  // Pull once per successful sign-in so the app reflects Drive on arrival.
  useEffect(() => {
    if (auth.signedIn) void vault.pullFromDrive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.signedIn])

  return (
    <div className="flex h-full">
      <Sidebar
        route={route}
        onNavigate={navigate}
        signedIn={auth.signedIn}
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
      />

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header
          className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 border-b bg-[var(--card)] px-6"
          style={{ borderColor: 'var(--line)' }}
        >
          <h1 className="text-[15px] font-semibold">{TITLES[route]}</h1>
          <span className="ml-auto text-xs" style={{ color: 'var(--ink-muted)' }}>
            {vault.dirty ? '저장 대기 중…' : vault.status === 'saving' ? '저장 중…' : ''}
          </span>
        </header>

        <div className="mx-auto w-full max-w-[1200px] p-5 md:p-6">
          {route === 'dashboard' && <Dashboard vault={vault} onGoToImport={() => navigate('import')} />}

          {route === 'ledger' && <Ledger vault={vault} />}

          {route === 'import' && (
            <Import vault={vault} signedIn={auth.signedIn} onConnect={() => void auth.connect()} />
          )}

          {route === 'inspect' && <Inspect signedIn={auth.signedIn} onConnect={() => void auth.connect()} />}

          {route === 'settings' && (
            <Settings
              signedIn={auth.signedIn}
              authBusy={auth.busy}
              authError={auth.error}
              onConnect={() => void auth.connect()}
              onDisconnect={auth.disconnect}
              vault={vault}
            />
          )}

          {PENDING[route] && (
            <Card title={`${TITLES[route]} — 준비 중`}>
              <Muted>{PENDING[route]}</Muted>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}
