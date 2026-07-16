/** Browser-safe device data returned by GET /devices. */
export interface PublicDevice {
  deviceId: string
  displayName: string | null
  houseId: string
  enabled: boolean
  lastSeenAt: string | null
}

export async function fetchDevices(): Promise<PublicDevice[]> {
  try {
    const response = await fetch('/api/backend/devices', { cache: 'no-store' })
    if (!response.ok) return []

    const devices = (await response.json()) as PublicDevice[]
    return devices.sort((a, b) => a.deviceId.localeCompare(b.deviceId))
  } catch {
    return []
  }
}
