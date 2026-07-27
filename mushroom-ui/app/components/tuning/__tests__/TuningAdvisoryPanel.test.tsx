import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TuningAdvisoryPanel } from '@/app/components/tuning/TuningAdvisoryPanel'

describe('TuningAdvisoryPanel component', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('EventSource', class {
      close() {}
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders advisory recommendation and visual diff when data is valid', async () => {
    const mockData = {
      deviceId: 'DEV_001',
      kpi: null,
      currentConfig: {
        lamp_gain_scale: 1.0,
        mist_gain_scale: 1.0,
        mist_on_threshold: 0.25,
        mist_off_threshold: 0.15,
      },
      advisory: {
        suggestedConfig: {
          lamp_gain_scale: 1.0,
          mist_gain_scale: 1.0,
          mist_on_threshold: 0.28,
          mist_off_threshold: 0.15,
        },
        currentConfig: {
          lamp_gain_scale: 1.0,
          mist_gain_scale: 1.0,
          mist_on_threshold: 0.25,
          mist_off_threshold: 0.15,
        },
        delta: {
          mist_on_threshold: 0.03,
        },
        triggeredRules: ['R1_MIST_CHATTERING'],
        confidence: 'HIGH',
        rulesetVersion: 'v1.0.0',
        expectedBenefit: 'Giảm tần suất bật tắt phún sương.',
        kpiSnapshot: {
          deviceId: 'DEV_001',
          windowStart: '2026-07-27T00:00:00.000Z',
          windowEnd: '2026-07-27T10:00:00.000Z',
          tempRmse: 0.2,
          humidRmse: 1.5,
          mistSwitchCountPerHour: 12.5,
          mistOnDurationSec: 360,
          lampDutyCyclePercent: 45.0,
          lampAvgOnDurationSec: 120,
          overshootDurationSec: 0,
          undershootDurationSec: 0,
          dataCoveragePercent: 95.0,
          sampleCount: 720,
          configRevision: 1,
          dataQualityWarning: false,
        },
        observationWindowRequired: true,
      },
      blockReason: null,
      blockReasonDetail: null,
      generatedAt: new Date().toISOString(),
    }

    vi.mocked(fetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('tuning-recommendations')) {
        return {
          ok: true,
          json: async () => mockData,
        } as Response
      }
      return {
        ok: true,
        json: async () => ({ ticket: 't-123', expiresInSeconds: 30 }),
      } as Response
    })

    render(<TuningAdvisoryPanel deviceId="DEV_001" />)

    await waitFor(() => {
      expect(screen.getByText('Khuyến nghị tinh chỉnh')).toBeInTheDocument()
      expect(screen.getByText('Giảm tần suất bật tắt phún sương.')).toBeInTheDocument()
      expect(screen.getByText('R1_MIST_CHATTERING')).toBeInTheDocument()
    })

    const confirmButton = screen.getByRole('button', { name: /Xác nhận áp dụng/i })
    expect(confirmButton).not.toBeDisabled()
  })

  it('disables confirm button when blockReason is active', async () => {
    const blockedData = {
      deviceId: 'DEV_001',
      kpi: null,
      currentConfig: null,
      advisory: null,
      blockReason: 'DEVICE_OFFLINE',
      blockReasonDetail: 'Thiết bị ngoại tuyến quá 5 phút.',
      generatedAt: new Date().toISOString(),
    }

    vi.mocked(fetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('tuning-recommendations')) {
        return {
          ok: true,
          json: async () => blockedData,
        } as Response
      }
      return {
        ok: true,
        json: async () => ({ ticket: 't-123', expiresInSeconds: 30 }),
      } as Response
    })

    render(<TuningAdvisoryPanel deviceId="DEV_001" />)

    await waitFor(() => {
      expect(screen.getByText(/Thiết bị ngoại tuyến/i)).toBeInTheDocument()
    })

    const confirmButton = screen.getByRole('button', { name: /Xác nhận áp dụng/i })
    expect(confirmButton).toBeDisabled()
  })

  it('renders error message and disables confirm button when response payload is malformed', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('tuning-recommendations')) {
        return {
          ok: true,
          json: async () => ({ malformed: true }),
        } as Response
      }
      return {
        ok: true,
        json: async () => ({ ticket: 't-123', expiresInSeconds: 30 }),
      } as Response
    })

    render(<TuningAdvisoryPanel deviceId="DEV_001" />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    const confirmButton = screen.getByRole('button', { name: /Xác nhận áp dụng/i })
    expect(confirmButton).toBeDisabled()
  })
})
