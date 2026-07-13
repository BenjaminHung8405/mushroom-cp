import { DEFAULT_DEVICE_ID } from './telemetry-api'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

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
}

export interface CheckpointInput {
  metricType: 'TEMPERATURE' | 'HUMIDITY'
  cropDay: number
  targetValue: number
}

export type EndBatchStatus = 'COMPLETED' | 'ABORTED'

/**
 * Safely reads a JSON response. Returns null when the body is empty or malformed,
 * preventing "Unexpected end of JSON input" crashes.
 */
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

/**
 * Builds a human-readable error message without calling .json() on empty bodies.
 */
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
    // Not JSON — fall through to generic message below.
  }
  return `Yêu cầu thất bại (HTTP ${response.status}).`
}

export async function fetchDeviceMapping(
  deviceId = DEFAULT_DEVICE_ID,
): Promise<DeviceMapping> {
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
    // When there is no active batch, NestJS returns HTTP 200 with body `null`.
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

/**
 * A fetch wrapper that matches the requirement of simulating Bearer Token integration.
 * In a production system, we'd retrieve the JWT from localStorage or a Context/State.
 */
async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const token = 'simulated-jwt-token-placeholder' // simulated token matching CheckpointOwnerGuard check
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
