'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { fetchDevices, type PublicDevice } from './device-api'

interface SelectedDeviceContextValue {
  devices: PublicDevice[]
  selectedDevice: PublicDevice | null
  selectedDeviceId: string | null
  isLoadingDevices: boolean
  reloadDevices: () => Promise<void>
  selectDevice: (deviceId: string) => void
}

const SelectedDeviceContext = createContext<SelectedDeviceContextValue | undefined>(
  undefined,
)

const STORAGE_KEY = 'mushroom-ui:selected-device-id'

export function SelectedDeviceProvider({ children }: { children: ReactNode }) {
  const [devices, setDevices] = useState<PublicDevice[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [isLoadingDevices, setIsLoadingDevices] = useState(true)

  const reloadDevices = useCallback(async () => {
    setIsLoadingDevices(true)
    const nextDevices = await fetchDevices()
    const enabledDevices = nextDevices.filter((device) => device.enabled)
    const selectableDevices = enabledDevices.length > 0 ? enabledDevices : nextDevices

    setDevices(nextDevices)
    setSelectedDeviceId((currentId) => {
      const storedId = typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY)
      const preferredId = currentId ?? storedId
      return selectableDevices.some((device) => device.deviceId === preferredId)
        ? preferredId
        : selectableDevices[0]?.deviceId ?? null
    })
    setIsLoadingDevices(false)
  }, [])

  useEffect(() => {
    void reloadDevices()
  }, [reloadDevices])

  const selectDevice = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId)
    window.localStorage.setItem(STORAGE_KEY, deviceId)
  }, [])

  const selectedDevice = useMemo(
    () => devices.find((device) => device.deviceId === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  )

  const value = useMemo(
    () => ({
      devices,
      selectedDevice,
      selectedDeviceId,
      isLoadingDevices,
      reloadDevices,
      selectDevice,
    }),
    [devices, selectedDevice, selectedDeviceId, isLoadingDevices, reloadDevices, selectDevice],
  )

  return (
    <SelectedDeviceContext.Provider value={value}>
      {children}
    </SelectedDeviceContext.Provider>
  )
}

export function useSelectedDevice(): SelectedDeviceContextValue {
  const context = useContext(SelectedDeviceContext)
  if (!context) {
    throw new Error('useSelectedDevice must be used within a SelectedDeviceProvider')
  }
  return context
}
