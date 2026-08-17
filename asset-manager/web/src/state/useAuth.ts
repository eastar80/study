import { useCallback, useEffect, useState } from 'react'
import { isSignedIn, onAuthChange, signIn, signOut } from '../lib/google/gis'

export interface AuthState {
  signedIn: boolean
  busy: boolean
  error: string | null
  connect: () => Promise<void>
  disconnect: () => void
  clearError: () => void
}

export function useAuth(): AuthState {
  const [signedIn, setSignedIn] = useState(isSignedIn)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => onAuthChange(() => setSignedIn(isSignedIn())), [])

  const connect = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await signIn()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    signOut()
  }, [])

  return { signedIn, busy, error, connect, disconnect, clearError: () => setError(null) }
}
