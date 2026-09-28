import { useEffect, useState } from 'react'

export function useMediaQuery(query) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const update = () => setMatch(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [query])
  return match
}

// Pass an element from a callback ref (useState setter), not a ref object.
export function useElementHeight(el) {
  const [h, setH] = useState(0)
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(() => setH(el.getBoundingClientRect().height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return h
}

// localStorage can throw in private windows, so every access is guarded.
export const storage = {
  get(key) {
    try {
      return window.localStorage.getItem(`blastradius918.${key}`)
    } catch {
      return null
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(`blastradius918.${key}`, value)
    } catch {
      // Preferences just won't stick.
    }
  },
}
