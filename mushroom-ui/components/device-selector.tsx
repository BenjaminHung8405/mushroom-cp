'use client'

import { useSelectedDevice } from '@/lib/selected-device-context'

export function DeviceSelector() {
  const {
    devices,
    selectedDeviceId,
    isLoadingDevices,
    selectDevice,
  } = useSelectedDevice()

  if (isLoadingDevices) {
    return <span className="text-xs text-muted-foreground">Đang tải thiết bị...</span>
  }

  if (devices.length === 0) {
    return <span className="text-xs text-amber-400">Chưa có thiết bị</span>
  }

  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="hidden sm:inline">Thiết bị</span>
      <select
        aria-label="Chọn thiết bị"
        className="h-8 max-w-52 rounded-md border border-border bg-slate-950 px-2 text-xs text-foreground outline-none transition-colors focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
        value={selectedDeviceId ?? ''}
        onChange={(event) => selectDevice(event.target.value)}
      >
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId} disabled={!device.enabled}>
            {device.displayName ?? device.deviceId}{device.enabled ? '' : ' (đã tắt)'}
          </option>
        ))}
      </select>
    </label>
  )
}
