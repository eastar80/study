import { Component, type ErrorInfo, type ReactNode } from 'react'
import { clearCache } from '../lib/data/localStore'

/**
 * A thrown render unmounts the whole tree, and a blank page is
 * indistinguishable from a failed deploy — the user cannot report what they
 * cannot see. This keeps the message on screen.
 *
 * The recovery button clears the local cache because that is what has actually
 * broken so far: a cache written before a field existed. Drive still holds the
 * data, so discarding the cache costs nothing but unsaved edits, which the
 * warning names.
 */

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  stack: string | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ stack: info.componentStack ?? null })
    console.error('화면을 그리는 중 오류가 발생했습니다.', error, info.componentStack)
  }

  render() {
    const { error, stack } = this.state
    if (!error) return this.props.children

    return (
      <div className="mx-auto max-w-[720px] p-6">
        <div className="rounded-lg border p-5" style={{ borderColor: 'var(--line)', background: 'var(--card)' }}>
          <h1 className="text-[15px] font-semibold">화면을 표시하지 못했습니다</h1>

          <p className="mt-3 text-sm" style={{ color: 'var(--ink-muted)' }}>
            아래 내용을 그대로 알려주시면 원인을 찾을 수 있습니다.
          </p>

          <pre
            className="mt-3 overflow-x-auto rounded border p-3 text-xs whitespace-pre-wrap"
            style={{ borderColor: 'var(--line)' }}
          >
            {error.message}
            {stack ? `\n${stack.trim()}` : ''}
          </pre>

          <p className="mt-4 text-sm" style={{ color: 'var(--ink-muted)' }}>
            이 기기에 보관된 캐시가 원인일 수 있습니다. 지우면 Drive에서 다시 받아옵니다.{' '}
            <strong>아직 Drive에 저장되지 않은 변경은 사라집니다.</strong>
          </p>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-sm"
              style={{ borderColor: 'var(--line)' }}
              onClick={() => {
                void clearCache().then(() => window.location.reload())
              }}
            >
              캐시를 지우고 다시 시도
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-sm"
              style={{ borderColor: 'var(--line)' }}
              onClick={() => window.location.reload()}
            >
              새로고침만
            </button>
          </div>
        </div>
      </div>
    )
  }
}
