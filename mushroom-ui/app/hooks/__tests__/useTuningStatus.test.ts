import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildStreamUrl,
  calculateBackoffDelay,
  useTuningStatus,
} from '@/app/hooks/useTuningStatus'

describe('useTuningStatus hook & helpers', () => {
  let activeMockInstance: MockEventSource | null = null

  class MockEventSource {
    url: string
    onopen: (() => void) | null = null
    onmessage: ((ev: { data: string }) => void) | null = null
    onerror: (() => void) | null = null
    closed = false

    constructor(url: string) {
      this.url = url
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      activeMockInstance = this
    }

    close() {
      this.closed = true
    }
  }

  beforeEach(() => {
    activeMockInstance = null
    vi.stubGlobal('EventSource', MockEventSource)
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('exponential backoff & stream URL helpers', () => {
    it('calculateBackoffDelay follows 500ms -> 1s -> 2s -> capped at 10s', () => {
      expect(calculateBackoffDelay(0)).toBe(500)
      expect(calculateBackoffDelay(1)).toBe(1000)
      expect(calculateBackoffDelay(2)).toBe(2000)
      expect(calculateBackoffDelay(3)).toBe(4000)
      expect(calculateBackoffDelay(4)).toBe(8000)
      expect(calculateBackoffDelay(5)).toBe(10000)
      expect(calculateBackoffDelay(10)).toBe(10000)
    })

    it('buildStreamUrl constructs valid EventSource URL with ticket param', () => {
      const url = buildStreamUrl('DEV_001', 'ticket-abc')
      expect(url).toContain('/api/backend/devices/DEV_001/tuning-configurations/stream?ticket=ticket-abc')
    })
  })

  describe('useTuningStatus lifecycle', () => {
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
        expect(activeMockInstance).not.toBeNull()
        expect(activeMockInstance?.url).toContain(
          '/api/backend/devices/DEV_001/tuning-configurations/stream?ticket=ticket-123',
        )
      })

      act(() => {
        activeMockInstance?.onopen?.()
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

      await vi.waitFor(() => expect(activeMockInstance).not.toBeNull())

      // Initial open
      act(() => {
        activeMockInstance?.onopen?.()
      })
      expect(onReconnect).not.toHaveBeenCalled()

      // Trigger disconnect
      act(() => {
        activeMockInstance?.onerror?.()
      })

      // Advance 500ms backoff
      await act(async () => {
        vi.advanceTimersByTime(500)
      })

      await vi.waitFor(() => expect(activeMockInstance).not.toBeNull())

      // Reconnect open
      act(() => {
        activeMockInstance?.onopen?.()
      })

      expect(onReconnect).toHaveBeenCalledTimes(1)
    })

    it('parses valid SSE messages including rejectionReason and filters cross-device messages', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ticket: 'ticket-789', expiresInSeconds: 30 }),
      } as Response)

      const { result } = renderHook(() => useTuningStatus('DEV_001'))

      await waitFor(() => expect(activeMockInstance).not.toBeNull())

      act(() => {
        activeMockInstance?.onopen?.()
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
        activeMockInstance?.onmessage?.({ data: JSON.stringify(eventDev2) })
      })
      expect(result.current.event).toBeNull()

      act(() => {
        activeMockInstance?.onmessage?.({ data: JSON.stringify(eventDev1) })
      })
      expect(result.current.event).toEqual(eventDev1)
    })

    it('rejects malformed SSE events (negative/fractional revision, bad timestamp, out-of-bounds snapshot, malformed reason)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ticket: 'ticket-789', expiresInSeconds: 30 }),
      } as Response)

      const { result } = renderHook(() => useTuningStatus('DEV_001'))

      await waitFor(() => expect(activeMockInstance).not.toBeNull())
      act(() => { activeMockInstance?.onopen?.() })

      const baseEvent = {
        id: 'e1',
        deviceId: 'DEV_001',
        commandId: 'cmd-1',
        revision: 1,
        status: 'PENDING',
        config: { lamp_gain_scale: 1.0, mist_gain_scale: 1.0, mist_on_threshold: 0.25, mist_off_threshold: 0.15 },
        publishedAt: null,
        createdAt: '2026-07-27T10:00:00.000Z',
        updatedAt: '2026-07-27T10:00:00.000Z',
        rejectionReason: null,
      }

      // Negative revision
      act(() => { activeMockInstance?.onmessage?.({ data: JSON.stringify({ ...baseEvent, revision: -1 }) }) })
      expect(result.current.event).toBeNull()

      // Fractional revision
      act(() => { activeMockInstance?.onmessage?.({ data: JSON.stringify({ ...baseEvent, revision: 1.5 }) }) })
      expect(result.current.event).toBeNull()

      // Invalid timestamp
      act(() => { activeMockInstance?.onmessage?.({ data: JSON.stringify({ ...baseEvent, createdAt: 'not-a-date' }) }) })
      expect(result.current.event).toBeNull()

      // Empty commandId
      act(() => { activeMockInstance?.onmessage?.({ data: JSON.stringify({ ...baseEvent, commandId: '' }) }) })
      expect(result.current.event).toBeNull()

      // Config out of hard bounds
      act(() => { activeMockInstance?.onmessage?.({ data: JSON.stringify({ ...baseEvent, config: { ...baseEvent.config, lamp_gain_scale: 2.5 } }) }) })
      expect(result.current.event).toBeNull()

      // Hysteresis violation
      act(() => { activeMockInstance?.onmessage?.({ data: JSON.stringify({ ...baseEvent, config: { ...baseEvent.config, mist_off_threshold: 0.30, mist_on_threshold: 0.25 } }) }) })
      expect(result.current.event).toBeNull()

      // Malformed rejection reason (object)
      act(() => { activeMockInstance?.onmessage?.({ data: JSON.stringify({ ...baseEvent, rejectionReason: { bad: true } }) }) })
      expect(result.current.event).toBeNull()
    })

    it('closes EventSource and cancels pending ticket requests on unmount', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ticket: 'ticket-999', expiresInSeconds: 30 }),
      } as Response)

      const { unmount } = renderHook(() => useTuningStatus('DEV_001'))

      await waitFor(() => expect(activeMockInstance).not.toBeNull())

      const instance = activeMockInstance
      unmount()

      expect(instance?.closed).toBe(true)
    })
  })
})
