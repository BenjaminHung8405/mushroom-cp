'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export interface ScrubberContextValue {
  hoverTimeMs: number | null
  rangeStart: number
  rangeEnd: number
  setHoverTimeMs: (ms: number | null) => void
  step: (deltaMs: number) => void
  reset: () => void
}

const ScrubberContext = createContext<ScrubberContextValue | null>(null)

export function ScrubberProvider({
  children,
  rangeStart,
  rangeEnd,
}: {
  children: ReactNode
  rangeStart: number
  rangeEnd: number
}) {
  const [hoverTimeMs, setHoverTimeMsRaw] = useState<number | null>(null)

  const setHoverTimeMs = useCallback(
    (ms: number | null) => {
      if (ms === null) {
        setHoverTimeMsRaw(null)
        return
      }
      const clamped = Math.max(rangeStart, Math.min(rangeEnd, ms))
      setHoverTimeMsRaw(clamped)
    },
    [rangeStart, rangeEnd],
  )

  const step = useCallback(
    (deltaMs: number) => {
      setHoverTimeMsRaw((current) => {
        const base = current ?? (rangeStart + rangeEnd) / 2
        const next = base + deltaMs
        return Math.max(rangeStart, Math.min(rangeEnd, next))
      })
    },
    [rangeStart, rangeEnd],
  )

  const reset = useCallback(() => setHoverTimeMsRaw(null), [])

  const value = useMemo<ScrubberContextValue>(
    () => ({ hoverTimeMs, rangeStart, rangeEnd, setHoverTimeMs, step, reset }),
    [hoverTimeMs, rangeStart, rangeEnd, setHoverTimeMs, step, reset],
  )

  return <ScrubberContext.Provider value={value}>{children}</ScrubberContext.Provider>
}

export function useScrubber(): ScrubberContextValue {
  const value = useContext(ScrubberContext)
  if (!value) {
    throw new Error('useScrubber must be used inside <ScrubberProvider>.')
  }
  return value
}

/** Map a timestamp to a [0..100] x coordinate inside the scrubber range. */
export function timeToX(ms: number, rangeStart: number, rangeEnd: number): number {
  const span = Math.max(1, rangeEnd - rangeStart)
  return Math.min(100, Math.max(0, ((ms - rangeStart) / span) * 100))
}

/**
 * Turns a pointer event over a plot rectangle into the equivalent timestamp.
 * Returns null when the pointer falls outside the rendered bounds.
 */
export function pointerToTimeMs(
  event: React.PointerEvent<Element>,
  rangeStart: number,
  rangeEnd: number,
): number | null {
  const target = event.currentTarget as Element | null
  if (!target) return null
  const rect = target.getBoundingClientRect()
  if (rect.width <= 0) return null
  const ratio = (event.clientX - rect.left) / rect.width
  if (!Number.isFinite(ratio)) return null
  const clamped = Math.max(0, Math.min(1, ratio))
  return rangeStart + clamped * (rangeEnd - rangeStart)
}
