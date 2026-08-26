import { useEffect, useState } from 'react'

/**
 * The current instant, re-rendering on a fixed interval so countdowns tick.
 *
 * One timer drives every countdown on a page: components read the same `now`,
 * so a list of ten orders costs one interval and one re-render per tick, not
 * ten. The interval is cleared on unmount.
 *
 * Every calculation that uses this stays a pure function taking `now` as an
 * argument — the clock enters the app here and nowhere else, which is what
 * keeps the deadline logic testable.
 */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}
