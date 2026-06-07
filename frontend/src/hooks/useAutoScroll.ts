import { useEffect, useRef } from 'react'

export function useAutoScroll<T extends HTMLElement>() {
  const containerRef = useRef<T>(null)
  const userScrolledRef = useRef(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function onScroll() {
      if (!el) return
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      userScrolledRef.current = distFromBottom > 64
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver(() => {
      if (!userScrolledRef.current) {
        el.scrollTop = el.scrollHeight
      }
    })

    // Observe children for height changes
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    observer.observe(el)

    return () => observer.disconnect()
  }, [])

  return containerRef
}
