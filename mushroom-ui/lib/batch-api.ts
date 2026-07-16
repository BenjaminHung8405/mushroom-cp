const API_BASE = '/api/backend'

export interface DeviceMapping {
  deviceId: string
  houseId: string
  displayName: string | null
}

export interface CheckpointResponse {
  id: string
  batchId: string
  metricType: 'TEMPERATURE' | 'HUMIDITY'
  cropDay: number
  targetValue: number
}

export interface ActiveBatch {
  id: string
  houseId: string
  profileName: string
  status: 'ACTIVE'
  startDate: string
  totalCropDays: number
  spawnRunningEndDay: number
  cropDay: number
  crop_day: number
  checkpoints: CheckpointResponse[]
}

export interface CreateBatchInput {
  houseId: string
  profileName: string
  totalCropDays: number
  spawnRunningEndDay?: number
  tempOptimalMin?: number
  tempOptimalMax?: number
  humidityOptimalMin?: number
  humidityOptimalMax?: number
  thermalShockProtection?: boolean
  thermalShockStart?: string
  thermalShockEnd?: string
}

export interface CheckpointInput {
  metricType: 'TEMPERATURE' | 'HUMIDITY'
  cropDay: number
  targetValue: number
}

export type EndBatchStatus = 'COMPLETED' | 'ABORTED'

async function safeJson<T>(response: Response): Promise<T | null> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    console.warn('[batch-api] Malformed JSON from', response.url, ':', text.slice(0, 200))
    return null
  }
}

async function getErrorMessage(response: Response): Promise<string> {
  const text = await response.text()
  if (!text) {
    return `Yêu cầu thất bại (HTTP ${response.status}). Backend có thể chưa sẵn sàng.`
  }
  try {
    const body = JSON.parse(text) as { message?: string | string[] }
    if (Array.isArray(body.message)) return body.message.join(', ')
    if (body.message) return body.message
  } catch {
    // Not JSON
  }
  return `Yêu cầu thất bại (HTTP ${response.status}).`
}

export async function fetchDeviceMapping(deviceId: string): Promise<DeviceMapping> {
  try {
    const response = await fetch(`${API_BASE}/devices/${encodeURIComponent(deviceId)}`)
    if (!response.ok) throw new Error(await getErrorMessage(response))
    const data = await safeJson<DeviceMapping>(response)
    if (!data) throw new Error('Backend trả về dữ liệu rỗng cho thiết bị.')
    return data
  } catch (cause) {
    if (cause instanceof Error) throw cause
    throw new Error('Không thể tải thông tin thiết bị.')
  }
}

export async function fetchActiveBatch(houseId: string): Promise<ActiveBatch | null> {
  try {
    const response = await fetch(`${API_BASE}/batches/active/${encodeURIComponent(houseId)}`)
    if (!response.ok) throw new Error(await getErrorMessage(response))
    const data = await safeJson<ActiveBatch>(response)
    return data
  } catch (cause) {
    if (cause instanceof Error) throw cause
    throw new Error('Không thể tải trạng thái vụ.')
  }
}

export async function createBatch(input: CreateBatchInput): Promise<ActiveBatch> {
  try {
    const response = await fetch(`${API_BASE}/batches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (response.status === 409) {
      throw new Error('Nhà nấm đã có vụ đang hoạt động. Hãy tải lại trạng thái trước khi thử lại.')
    }
    if (!response.ok) throw new Error(await getErrorMessage(response))
    const data = await safeJson<ActiveBatch>(response)
    if (!data) throw new Error('Backend trả về dữ liệu rỗng khi tạo vụ.')
    return data
  } catch (cause) {
    if (cause instanceof Error) throw cause
    throw new Error('Không thể bắt đầu vụ.')
  }
}

export async function endBatch(id: string, status: EndBatchStatus): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/batches/${encodeURIComponent(id)}/end`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!response.ok) throw new Error(await getErrorMessage(response))
  } catch (cause) {
    if (cause instanceof Error) throw cause
    throw new Error('Không thể kết thúc vụ.')
  }
}

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const token = 'simulated-jwt-token-placeholder'
  const headers = new Headers(options.headers)
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(url, { ...options, headers })
}

export async function updateBatchCheckpoints(
  batchId: string,
  checkpoints: CheckpointInput[],
): Promise<CheckpointResponse[]> {
  try {
    const response = await fetchWithAuth(
      `${API_BASE}/batches/${encodeURIComponent(batchId)}/checkpoints`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpoints }),
      },
    )
    if (!response.ok) throw new Error(await getErrorMessage(response))
    const data = await safeJson<CheckpointResponse[]>(response)
    if (!data) throw new Error('Backend trả về dữ liệu rỗng khi cập nhật checkpoints.')
    return data
  } catch (cause) {
    if (cause instanceof Error) throw cause
    throw new Error('Không thể cập nhật checkpoints.')
  }
}
