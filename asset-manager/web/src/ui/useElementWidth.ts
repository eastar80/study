import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * The rendered width of an element.
 *
 * The trend chart draws at 1:1 rather than scaling a fixed viewBox, so axis text
 * stays the size it was designed at and a pointer position maps straight to a
 * data index without a conversion that can drift.
 */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    setWidth(element.clientWidth)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, width]
}
