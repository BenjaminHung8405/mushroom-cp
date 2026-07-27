import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyDurableState,
  parseCreateCommandResponse,
  parseLatestTuningState,
  usePendingTuningCommand,
} from '@/app/hooks/usePendingTuningCommand'
import type { TuningStatusEvent } from '@/app/hooks/useTuningStatus'
import type { TuningConfigSnapshot } from '@/app/lib/tuning-schema'

describe('usePendingTuningCommand hook & parsers', () => {
  const dummyConfig: TuningConfigSnapshot = {
    lamp_gain_scale: 1.0,
    mist_gain_scale: 1.0,
    mist_on_threshold: 0.25,
    mist_off_threshold: 0.15,
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('Durable State & Response Parsers', () => {
    it('parseCreateCommandResponse parses valid PENDING command payload', () => {
      expect(parseCreateCommandResponse({ commandId: 'c1', status: 'PENDING' })).toEqual({
        commandId: 'c1',
        status: 'PENDING',
      })
      expect(parseCreateCommandResponse({ commandId: 'c1', status: 'IN_SYNC' })).toBeNull()
      expect(parseCreateCommandResponse(null)).toBeNull()
    })

    it('parseLatestTuningState parses valid latest state payload', () => {
      expect(
        parseLatestTuningState({ commandId: 'c1', status: 'IN_SYNC', rejectionReason: null }),
      ).toEqual({ commandId: 'c1', status: 'IN_SYNC', rejectionReason: null })
      expect(parseLatestTuningState({ invalid: 'payload' })).toBeNull()
    })

    it('preserves specific rejectionReason when backend rejects command', () => {
      const pending = { commandId: 'cmd-1', state: 'PENDING' as const, rejectionReason: null }
      const res = applyDurableState(
        { commandId: 'cmd-1', status: 'REJECTED', rejectionReason: 'REVISION_MISMATCH' },
        pending,
      )
      expect(res).toEqual({
        commandId: 'cmd-1',
        state: 'REJECTED',
        rejectionReason: 'REVISION_MISMATCH',
      })
    })

    it('fallbacks to generic rejection message only when server returns null rejectionReason', () => {
      const pending = { commandId: 'cmd-1', state: 'PENDING' as const, rejectionReason: null }
      const res = applyDurableState(
        { commandId: 'cmd-1', status: 'REJECTED', rejectionReason: null },
        pending,
      )
      expect(res).toEqual({
        commandId: 'cmd-1',
        state: 'REJECTED',
        rejectionReason: 'Thiết bị đã từ chối cấu hình được đề xuất.',
      })
    })
  })

  describe('usePendingTuningCommand Hook lifecycle', () => {
    it('submits recommendation via POST and sets pending state on HTTP 202', async () => {
      const commandId = 'cmd-123-uuid'
      vi.stubGlobal('crypto', { randomUUID: () => commandId })

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ commandId, status: 'PENDING' }),
      } as Response) // POST 202

      const { result } = renderHook(() => usePendingTuningCommand('DEV_001', null))

      let success = false
      await act(async () => {
        success = await result.current.submitRecommendation(dummyConfig)
      })

      expect(success).toBe(true)
      expect(result.current.pendingCommand).toEqual({
        commandId,
        state: 'PENDING',
        rejectionReason: null,
      })
    })

    it('REGRESSION TEST (K3/K5): UI remains PENDING even if REST GET latest is IN_SYNC before SSE event arrives; transitions to IN_SYNC only after matching SSE event', async () => {
      const commandId = 'cmd-strict-k3'
      vi.stubGlobal('crypto', { randomUUID: () => commandId })

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ commandId, status: 'PENDING' }),
      } as Response) // POST 202

      const { result, rerender } = renderHook(
        ({ event }: { event: TuningStatusEvent | null }) =>
          usePendingTuningCommand('DEV_001', event),
        { initialProps: { event: null as TuningStatusEvent | null } },
      )

      await act(async () => {
        await result.current.submitRecommendation(dummyConfig)
      })

      expect(result.current.pendingCommand).toEqual({
        commandId,
        state: 'PENDING',
        rejectionReason: null,
      })

      const sseInSyncEvent: TuningStatusEvent = {
        id: 'evt-1',
        deviceId: 'DEV_001',
        commandId,
        revision: 2,
        status: 'IN_SYNC',
        config: dummyConfig,
        publishedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        rejectionReason: null,
      }

      rerender({ event: sseInSyncEvent })

      expect(result.current.pendingCommand).toEqual({
        commandId,
        state: 'IN_SYNC',
        rejectionReason: null,
      })
    })

    it('transitions state and preserves rejectionReason when matching SSE REJECTED event is received', async () => {
      const commandId = 'cmd-sse-test'
      vi.stubGlobal('crypto', { randomUUID: () => commandId })

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ commandId, status: 'PENDING' }),
      } as Response)

      const { result, rerender } = renderHook(
        ({ event }: { event: TuningStatusEvent | null }) =>
          usePendingTuningCommand('DEV_001', event),
        { initialProps: { event: null as TuningStatusEvent | null } },
      )

      await act(async () => {
        await result.current.submitRecommendation(dummyConfig)
      })
      expect(result.current.pendingCommand?.state).toBe('PENDING')

      const matchingEvent: TuningStatusEvent = {
        id: 'event-1',
        deviceId: 'DEV_001',
        commandId,
        revision: 2,
        status: 'REJECTED',
        config: dummyConfig,
        publishedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        rejectionReason: 'PERSISTENCE_NOT_CONFIRMED',
      }

      rerender({ event: matchingEvent })
      expect(result.current.pendingCommand).toEqual({
        commandId,
        state: 'REJECTED',
        rejectionReason: 'PERSISTENCE_NOT_CONFIRMED',
      })
    })

    it('transitions state to TIMEOUT after 30 seconds if still PENDING', async () => {
      const commandId = 'cmd-timeout-test'
      vi.stubGlobal('crypto', { randomUUID: () => commandId })

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ commandId, status: 'PENDING' }),
      } as Response)

      const { result } = renderHook(() => usePendingTuningCommand('DEV_001', null))

      await act(async () => {
        await result.current.submitRecommendation(dummyConfig)
      })
      expect(result.current.pendingCommand?.state).toBe('PENDING')

      act(() => {
        vi.advanceTimersByTime(30_000)
      })

      expect(result.current.pendingCommand?.state).toBe('TIMEOUT')
    })
  })
})
