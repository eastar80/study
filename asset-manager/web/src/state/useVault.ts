import { useCallback, useEffect, useRef, useState } from 'react'
import { ConflictError, loadData, saveData, type DriveFileMeta } from '../lib/google/drive'
import { emptyData, normaliseData, type AssetData } from '../lib/data/model'
import { readCache, writeCache } from '../lib/data/localStore'

export type SyncStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'offline' | 'conflict' | 'error'

const SAVE_DEBOUNCE_MS = 2500

export interface Vault {
  data: AssetData
  status: SyncStatus
  message: string | null
  dirty: boolean
  lastSyncedIso: string | null
  /** Applies an edit locally and schedules a Drive write. */
  update: (mutate: (draft: AssetData) => AssetData) => void
  pullFromDrive: () => Promise<void>
  pushToDrive: () => Promise<void>
}

/**
 * Local-first data store: edits land in IndexedDB immediately and are pushed to
 * Drive on a debounce. A revision mismatch surfaces as a conflict rather than
 * overwriting whatever the other device wrote.
 */
export function useVault(signedIn: boolean): Vault {
  const [data, setData] = useState<AssetData>(emptyData)
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [lastSyncedIso, setLastSyncedIso] = useState<string | null>(null)

  const revisionRef = useRef<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const dataRef = useRef<AssetData>(data)
  dataRef.current = data

  // Rehydrate from the local cache before any network call, so a cold start on a
  // flaky connection still shows the last known state.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const cached = await readCache()
      if (cancelled || !cached) return
      // Normalise, exactly as the Drive path does. A cache written before a
      // field existed is missing it, and reading it raw put `undefined` where
      // the code expects an array — the app rendered once from `emptyData()`
      // and then blanked when this landed.
      const next = normaliseData(cached.data)
      dataRef.current = next
      setData(next)
      setDirty(cached.dirty)
      revisionRef.current = cached.revisionId
      setLastSyncedIso(cached.savedAtIso)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const persistLocal = useCallback(async (next: AssetData, isDirty: boolean) => {
    await writeCache({
      data: next,
      revisionId: revisionRef.current,
      dirty: isDirty,
      savedAtIso: new Date().toISOString(),
    })
  }, [])

  const pushToDrive = useCallback(async () => {
    if (!signedIn) {
      setStatus('offline')
      setMessage('로그인하지 않아 Drive에 저장하지 못했습니다. 변경은 이 기기에 보관되어 있습니다.')
      return
    }

    setStatus('saving')
    setMessage(null)
    try {
      const meta: DriveFileMeta = await saveData(dataRef.current, revisionRef.current)
      revisionRef.current = meta.headRevisionId ?? null
      setDirty(false)
      setStatus('saved')
      const now = new Date().toISOString()
      setLastSyncedIso(now)
      await persistLocal(dataRef.current, false)
    } catch (cause) {
      if (cause instanceof ConflictError) {
        setStatus('conflict')
        setMessage(cause.message)
        return
      }
      setStatus('error')
      setMessage(cause instanceof Error ? cause.message : String(cause))
    }
  }, [persistLocal, signedIn])

  const scheduleSave = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      void pushToDrive()
    }, SAVE_DEBOUNCE_MS)
  }, [pushToDrive])

  const update = useCallback(
    (mutate: (draft: AssetData) => AssetData) => {
      const next = mutate(dataRef.current)
      dataRef.current = next
      setData(next)
      setDirty(true)
      void persistLocal(next, true)
      scheduleSave()
    },
    [persistLocal, scheduleSave],
  )

  const pullFromDrive = useCallback(async () => {
    if (!signedIn) return
    setStatus('loading')
    setMessage(null)
    try {
      const loaded = await loadData<unknown>()
      if (!loaded) {
        // Nothing on Drive yet — create the file so the user can see it exists.
        const meta = await saveData(dataRef.current)
        revisionRef.current = meta.headRevisionId ?? null
        setStatus('saved')
        setMessage('Drive에 data.json 을 새로 만들었습니다.')
        setLastSyncedIso(new Date().toISOString())
        await persistLocal(dataRef.current, false)
        return
      }

      const next = normaliseData(loaded.data)
      revisionRef.current = loaded.meta.headRevisionId ?? null
      dataRef.current = next
      setData(next)
      setDirty(false)
      setStatus('idle')
      setLastSyncedIso(loaded.meta.modifiedTime ?? new Date().toISOString())
      await persistLocal(next, false)
    } catch (cause) {
      setStatus('error')
      setMessage(cause instanceof Error ? cause.message : String(cause))
    }
  }, [persistLocal, signedIn])

  // Flush a pending debounce when the tab goes away, so a screen lock on a
  // tablet does not lose the last edit.
  useEffect(() => {
    const flush = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
        void pushToDrive()
      }
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
    })
    return () => window.removeEventListener('pagehide', flush)
  }, [pushToDrive])

  return { data, status, message, dirty, lastSyncedIso, update, pullFromDrive, pushToDrive }
}
