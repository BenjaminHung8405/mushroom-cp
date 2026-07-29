import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  deviceSectionStorageKey,
  usePersistedDeviceSection,
} from '@/app/lib/use-persisted-device-section'

function Harness({ deviceId }: { deviceId: string | null }) {
  const section = usePersistedDeviceSection('analysis', deviceId)
  return <button type="button" onClick={() => section.setOpen(!section.open)}>{section.open ? 'open' : 'closed'}</button>
}

describe('usePersistedDeviceSection', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('starts closed for a new device and restores each device independently', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
    const { rerender } = render(<Harness deviceId="device-a" />)
    expect(screen.getByRole('button')).toHaveTextContent('closed')

    act(() => screen.getByRole('button').click())
    expect(values.get(deviceSectionStorageKey('analysis', 'device-a'))).toBe('true')

    rerender(<Harness deviceId="device-b" />)
    expect(screen.getByRole('button')).toHaveTextContent('closed')

    rerender(<Harness deviceId="device-a" />)
    expect(screen.getByRole('button')).toHaveTextContent('open')
  })

  it('fails safely when browser storage is unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    render(<Harness deviceId="device-a" />)
    expect(screen.getByRole('button')).toHaveTextContent('closed')
    expect(() => screen.getByRole('button').click()).not.toThrow()

    expect(getItem).toHaveBeenCalled()
    expect(setItem).toHaveBeenCalled()
  })
})
