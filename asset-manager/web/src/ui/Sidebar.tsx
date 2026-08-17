import type { Route } from './hashRoute'

const NAV: { route: Route; label: string; icon: string; ready: boolean }[] = [
  { route: 'dashboard', label: '대시보드', icon: '▦', ready: false },
  { route: 'ledger', label: '자산 관리', icon: '▤', ready: true },
  { route: 'portfolio', label: '포트폴리오', icon: '◪', ready: false },
  { route: 'timeline', label: '타임라인', icon: '▥', ready: false },
  { route: 'import', label: '가져오기', icon: '⤓', ready: true },
  { route: 'inspect', label: '시트 분석', icon: '◎', ready: true },
]

export function Sidebar({
  route,
  onNavigate,
  signedIn,
  collapsed,
  onToggle,
}: {
  route: Route
  onNavigate: (route: Route) => void
  signedIn: boolean
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <nav
      className={`flex shrink-0 flex-col border-r bg-[var(--card)] transition-[width] duration-200 ${
        collapsed ? 'w-[68px]' : 'w-[240px]'
      }`}
      style={{ borderColor: 'var(--line)' }}
    >
      <div className="flex h-16 items-center gap-2.5 px-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
          자
        </span>
        {!collapsed && <span className="truncate text-[15px] font-semibold">내 자산관리</span>}
        <button
          onClick={onToggle}
          aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
          className="ml-auto rounded-md p-1.5 text-xs hover:bg-[var(--surface)]"
          style={{ color: 'var(--ink-muted)' }}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <ul className="flex-1 space-y-1 px-2 py-2">
        {NAV.map((entry) => {
          const active = route === entry.route
          return (
            <li key={entry.route}>
              <button
                onClick={() => onNavigate(entry.route)}
                title={collapsed ? entry.label : undefined}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                  active
                    ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-700/20 dark:text-brand-200'
                    : 'hover:bg-[var(--surface)]'
                }`}
              >
                <span className="w-4 shrink-0 text-center opacity-70">{entry.icon}</span>
                {!collapsed && (
                  <>
                    <span className="truncate">{entry.label}</span>
                    {!entry.ready && (
                      <span className="ml-auto text-[10px] opacity-50">준비중</span>
                    )}
                  </>
                )}
              </button>
            </li>
          )
        })}
      </ul>

      <div className="space-y-1 border-t px-2 py-3" style={{ borderColor: 'var(--line)' }}>
        <button
          onClick={() => onNavigate('settings')}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
            route === 'settings'
              ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-700/20 dark:text-brand-200'
              : 'hover:bg-[var(--surface)]'
          }`}
        >
          <span className="w-4 shrink-0 text-center opacity-70">⚙</span>
          {!collapsed && <span>환경 설정</span>}
        </button>

        {!collapsed && (
          <div className="px-3 pt-2 text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            <span className={signedIn ? 'text-emerald-600 dark:text-emerald-400' : ''}>
              {signedIn ? '● Drive 연결됨' : '○ 연결 안 됨'}
            </span>
            <br />
            데이터는 내 Google Drive에만 저장됩니다.
          </div>
        )}
      </div>
    </nav>
  )
}
