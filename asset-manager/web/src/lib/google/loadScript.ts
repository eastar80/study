const loaded = new Map<string, Promise<void>>()

/**
 * Loads an external script once and resolves when `ready` reports the global it
 * defines is usable. Google's loaders resolve `onload` before their globals are
 * attached, so polling is the reliable signal.
 */
export function loadScript(src: string, ready: () => boolean): Promise<void> {
  const existing = loaded.get(src)
  if (existing) return existing

  const promise = new Promise<void>((resolve, reject) => {
    if (ready()) {
      resolve()
      return
    }

    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onerror = () => {
      loaded.delete(src)
      reject(new Error(`스크립트를 불러올 수 없습니다: ${src}`))
    }
    script.onload = () => {
      const deadline = Date.now() + 10_000
      const poll = () => {
        if (ready()) {
          resolve()
        } else if (Date.now() > deadline) {
          loaded.delete(src)
          reject(new Error(`스크립트 초기화 시간이 초과되었습니다: ${src}`))
        } else {
          setTimeout(poll, 50)
        }
      }
      poll()
    }
    document.head.appendChild(script)
  })

  loaded.set(src, promise)
  return promise
}
