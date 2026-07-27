import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  MicroclimateHoverCard,
  findNearestPoint,
  type RawPoint,
} from '@/components/microclimate-hover-card'

function makePoint(overrides: Partial<RawPoint>): RawPoint {
  return {
    time: new Date(overrides.ms ?? 0).toISOString(),
    ms: overrides.ms ?? 0,
    dataQuality: overrides.dataQuality ?? 'trusted',
    bootCount: overrides.bootCount ?? null,
    temperature: overrides.temperature ?? null,
    humidity: overrides.humidity ?? null,
    mistState: overrides.mistState ?? null,
    lampState: overrides.lampState ?? null,
    deltaTimeS: overrides.deltaTimeS ?? null,
    fuzzyTempDemand: overrides.fuzzyTempDemand ?? null,
    fuzzyHumidDemand: overrides.fuzzyHumidDemand ?? null,
  }
}

describe('findNearestPoint', () => {
  it('returns the most recent point at or before the hover timestamp', () => {
    const a = makePoint({ ms: 1_000, temperature: 30 })
    const b = makePoint({ ms: 2_000, temperature: 31 })
    const c = makePoint({ ms: 3_000, temperature: 32 })
    const points = [a, b, c]

    expect(findNearestPoint(points, 2_500)?.ms).toBe(2_000)
    expect(findNearestPoint(points, 3_000)?.ms).toBe(3_000)
  })

  it('falls back to the first point when hover is before the first sample', () => {
    const points = [makePoint({ ms: 5_000, temperature: 30 })]
    expect(findNearestPoint(points, 1_000)?.ms).toBe(5_000)
  })

  it('returns null with an empty dataset or a null hover time', () => {
    expect(findNearestPoint([], 1_000)).toBeNull()
    expect(findNearestPoint([makePoint({ ms: 1_000 })], null)).toBeNull()
  })
})

describe('<MicroclimateHoverCard />', () => {
  afterEach(() => cleanup())

  const defaultProps = {
    rawPoints: [
      makePoint({
        ms: 1_700_000_000_000,
        temperature: 31.2,
        humidity: 74.5,
        mistState: false,
        lampState: true,
      }),
    ],
    tempOptimalRange: [28, 35] as [number, number],
    humidityOptimalRange: [70, 90] as [number, number],
    operatingMode: 'AI' as const,
    anchorClientX: 320,
    anchorClientY: 240,
  }

  it('renders temperature/humidity values and target chips when setpoints are present', () => {
    render(
      <MicroclimateHoverCard
        {...defaultProps}
        hoverTimeMs={1_700_000_000_000}
        temperatureSetpoint={32}
        humiditySetpoint={75}
      />,
    )

    expect(screen.getByText('31.2°C')).toBeInTheDocument()
    expect(screen.getByText('74.5%')).toBeInTheDocument()
    expect(screen.getByText('Mục tiêu: 32.0°C')).toBeInTheDocument()
    expect(screen.getByText('Mục tiêu: 75.0%')).toBeInTheDocument()
    expect(screen.getByText(/Chế độ:/)).toHaveTextContent('AI • Fuzzy')
  })

  it('omits the target chips when setpoints are null', () => {
    render(
      <MicroclimateHoverCard
        {...defaultProps}
        hoverTimeMs={1_700_000_000_000}
        temperatureSetpoint={null}
        humiditySetpoint={null}
      />,
    )
    expect(screen.queryByText(/Mục tiêu:/)).not.toBeInTheDocument()
  })

  it('shows the degraded-data chip when the hover interval is degraded', () => {
    render(
      <MicroclimateHoverCard
        {...defaultProps}
        hoverTimeMs={1_700_000_000_000}
        temperatureSetpoint={null}
        humiditySetpoint={null}
        inDegradedInterval
      />,
    )
    expect(screen.getByText('Dữ liệu ước lượng')).toBeInTheDocument()
  })

  it('renders nothing when hoverTimeMs is null', () => {
    const { container } = render(
      <MicroclimateHoverCard
        {...defaultProps}
        hoverTimeMs={null}
        temperatureSetpoint={null}
        humiditySetpoint={null}
      />,
    )
    expect(container.firstChild).toBeNull()
  })
})
