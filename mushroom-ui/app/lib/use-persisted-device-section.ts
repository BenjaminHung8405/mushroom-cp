'use client'

import { useCallback, useEffect, useState } from 'react'

const STORAGE_PREFIX = 'mushroom-ui:operations-section'

export function deviceSectionStorageKey(section: string, deviceId: string | null): string {
  return `${STORAGE_PREFIX}:${section}:${deviceId ?? 'unselected'}`
}

/**
 * A client-only persisted disclosure state. New devices always start closed;
 * a technician's choice is restored only after hydration to avoid SSR drift.
 */
export function usePersistedDeviceSection(section: string, deviceId: string | null) {
  const [hydrated, setHydrated] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setHydrated(false)
    let nextOpen: boolean
    try {
      nextOpen = window.localStorage.getItem(deviceSectionStorageKey(section, deviceId)) === 'true'
    } catch {
      nextOpen = false
    }
    setOpen(nextOpen)
    setHydrated(true)
  }, [deviceId, section])

  const setPersistedOpen = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    try {
      window.localStorage.setItem(deviceSectionStorageKey(section, deviceId), String(nextOpen))
    } catch {
      // Storage can be unavailable in private/restricted browser contexts.
    }
  }, [deviceId, section])

  return { open: hydrated ? open : false, setOpen: setPersistedOpen, hydrated }
}
