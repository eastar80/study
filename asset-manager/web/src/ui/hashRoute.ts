import { useEffect, useState } from 'react'

/**
 * Hash routing, matching the reference app's `#dashboard` style URLs. Hash
 * routing is what lets a static GitHub Pages build serve deep links without
 * server rewrites.
 */

export const ROUTES = [
  'dashboard',
  'ledger',
  'portfolio',
  'timeline',
  'import',
  'inspect',
  'settings',
] as const

export type Route = (typeof ROUTES)[number]

/** Importing the existing workbook is the next thing to do, so land there. */
export const DEFAULT_ROUTE: Route = 'import'

function parse(hash: string): Route {
  const name = hash.replace(/^#\/?/, '').split('/')[0] ?? ''
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : DEFAULT_ROUTE
}

export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash))

  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = (next: Route) => {
    window.location.hash = `#${next}`
  }

  return [route, navigate]
}
