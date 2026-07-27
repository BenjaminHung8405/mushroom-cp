import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTuningStatus } from '@/app/hooks/useTuningStatus'

describe('useTuningStatus hook', () => {
  let mockEventSourceInstance: MockEventSource | null = null

  class MockEventSource {
    url: string
    onopen: (() => void) | null = null
    onmessage: ((ev: { data: string }) => void) | null = null
    onerror: (() => void) | null = null
    closed = false

    constructor(url: string) {
      this.url = url
      mockEventSourceInstance = this
    }

    close() {
      this.closed = true
    }
  }

  beforeEach(() => {
    mockEventSourceInstance = null
    vi.stubGlobal('EventSource', MockEventSource)
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('requests stream ticket and opens EventSource stream', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ticket: 'ticket-123', expiresInSeconds: 30 }),
    } as Response)

    const { result } = renderHook(() => useTuningStatus('DEV_001'))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/backend/devices/DEV_001/tuning-configurations/stream-ticket',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    await waitFor(() => {
      expect(mockEventSourceInstance).not.toBeNull()
      expect(mockEventSourceInstance?.url).toContain('/api/backend/devices/DEV_001/tuning-configurations/stream?ticket=ticket-123')
    })

    act(() => {
      mockEventSourceInstance?.onopen?.()
    })

    expect(result.current.isConnected).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('calls onReconnect callback after reconnecting stream', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const onReconnect = vi.fn()

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ticket: 'ticket-456', expiresInSeconds: 30 }),
    } as Response)

    renderHook(() => useTuningStatus('DEV_001', onReconnect))

    await vi.waitFor(() => expect(mockEventSourceInstance).not.toBeNull())

    // Initial open
    act(() => {
      mockEventSourceInstance?.onopen?.()
    })
    expect(onReconnect).not.toHaveBeenCalled()

    // Trigger disconnect
    act(() => {
      mockEventSourceInstance?.onerror?.()
    })

    // Advance 500ms backoff
    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    await vi.waitFor(() => expect(mockEventSourceInstance).not.toBeNull())

    // Reconnect open
    act(() => {
      mockEventSourceInstance?.onopen?.()
    })

    expect(onReconnect).toHaveBeenCalledTimes(1)
  })

  it('parses valid SSE messages including rejectionReason and filters cross-device messages', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ticket: 'ticket-789', expiresInSeconds: 30 }),
    } as Response)

    const { result } = renderHook(() => useTuningStatus('DEV_001'))

    await waitFor(() => expect(mockEventSourceInstance).not.toBeNull())

    act(() => {
      mockEventSourceInstance?.onopen?.()
    })

    const eventDev1 = {
      id: 'e1',
      deviceId: 'DEV_001',
      commandId: 'cmd-1',
      revision: 1,
      status: 'REJECTED',
      config: { lamp_gain_scale: 1.0, mist_gain_scale: 1.0, mist_on_threshold: 0.25, mist_off_threshold: 0.15 },
      publishedAt: null,
      createdAt: '2026-07-27T10:00:00.000Z',
      updatedAt: '2026-07-27T10:00:00.000Z',
      rejectionReason: 'INVALID_SCHEMA',
    }

    const eventDev2 = {
      ...eventDev1,
      deviceId: 'DEV_002',
    }

    act(() => {
      mockEventSourceInstance?.onmessage?.({ data: JSON.stringify(eventDev2) })
    })
    expect(result.current.event).toBeNull()

    act(() => {
      mockEventSourceInstance?.onmessage?.({ data: JSON.stringify(eventDev1) })
    })
    expect(result.current.event).toEqual(eventDev1)
  })

  it('closes EventSource and cancels pending ticket requests on unmount', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ticket: 'ticket-999', expiresInSeconds: 30 }),
    } as Response)

    const { unmount } = renderHook(() => useTuningStatus('DEV_001'))

    await waitFor(() => expect(mockEventSourceInstance).not.toBeNull())

    const instance = mockEventSourceInstance
    unmount()

    expect(instance?.closed).toBe(true)
  })
})
