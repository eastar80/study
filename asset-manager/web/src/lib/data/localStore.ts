/**
 * IndexedDB cache. This is the app's first-class store: edits land here
 * immediately so input works without a network, and Drive is synced from it.
 */

import type { AssetData } from './model'

const DB_NAME = 'asset-manager'
const DB_VERSION = 1
const STORE = 'state'
const KEY = 'current'

export interface CachedState {
  data: AssetData
  /** Drive revision the cache was last known to match. */
  revisionId: string | null
  /** True when there are local edits not yet written to Drive. */
  dirty: boolean
  savedAtIso: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB를 열 수 없습니다.'))
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = run(tx.objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 요청이 실패했습니다.'))
    })
  } finally {
    db.close()
  }
}

export async function readCache(): Promise<CachedState | null> {
  try {
    const value = await withStore<CachedState | undefined>('readonly', (store) => store.get(KEY))
    return value ?? null
  } catch {
    // A blocked or unavailable IndexedDB (private browsing, quota) must not stop
    // the app — it just means no offline cache this session.
    return null
  }
}

export async function writeCache(state: CachedState): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.put(state, KEY))
  } catch {
    // Same reasoning as readCache: the cache is an optimisation, not the truth.
  }
}

export async function clearCache(): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(KEY))
  } catch {
    /* ignore */
  }
}
