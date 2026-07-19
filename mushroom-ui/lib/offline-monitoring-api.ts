export type DataQuality = 'trusted' | 'degraded'

export class OfflineMonitoringApiError extends Error {
  constructor(message: string, public readonly status: number | null = null) {
    super(message)
    this.name = 'OfflineMonitoringApiError'
  }
}

export interface OfflineMonitoringPoint {
  time: string
  dataQuality: DataQuality
  bootCount: number | null
  temperature: number | null
  humidity: number | null
  mistState: boolean | null
  lampState: boolean | null
  deltaTimeS: number | null
  fuzzyTempDemand: number | null
  fuzzyHumidDemand: number | null
}

const API_BASE = '/api/backend'

export async function fetchOfflineMonitoringHistory(
  deviceId: string,
  from: Date,
  to: Date,
): Promise<OfflineMonitoringPoint[]> {
  const url = new URL(
    `${API_BASE}/offline-sync/${encodeURIComponent(deviceId)}/history`,
    window.location.origin,
  )
  url.searchParams.set('from', from.toISOString())
  url.searchParams.set('to', to.toISOString())

  try {
    const response = await fetch(url.toString(), { cache: 'no-store' })
    if (!response.ok) {
      throw new OfflineMonitoringApiError(
        response.status >= 500
          ? 'Không thể truy vấn lịch sử InfluxDB.'
          : 'Yêu cầu lịch sử thiết bị không hợp lệ.',
        response.status,
      )
    }
    return await response.json() as OfflineMonitoringPoint[]
  } catch (error) {
    if (error instanceof OfflineMonitoringApiError) throw error
    throw new OfflineMonitoringApiError('Không thể kết nối tới backend.', null)
  }
}
