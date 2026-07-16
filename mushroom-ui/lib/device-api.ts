/** Browser-safe device data returned by GET /devices. */
export interface PublicDevice {
  deviceId: string
  displayName: string | null
  houseId: string
  enabled: boolean
  lastSeenAt: string | null
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export async function fetchDevices(): Promise<PublicDevice[]> {
  try {
    const response = await fetch(`${API_BASE}/devices`)
    if (!response.ok) return []

    const devices = (await response.json()) as PublicDevice[]
    return devices.sort((a, b) => a.deviceId.localeCompare(b.deviceId))
  } catch {
    return []
  }
}
