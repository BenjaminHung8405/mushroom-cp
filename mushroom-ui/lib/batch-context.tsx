'use client'

import React, { createContext, useContext, useState, useMemo, useCallback, useEffect } from 'react'
import type { ActiveBatch } from './batch-api'

export interface Checkpoint {
  day: number
  value: number
}

export interface DayTrack {
  day: number
  active: boolean
}

interface ProfilePreset {
  name: string
  tempCheckpoints: Checkpoint[]
  humidityCheckpoints: Checkpoint[]
  lightDaysActive: number
  totalCropDays?: number
  tempOptimalRange?: [number, number]
  humidityOptimalRange?: [number, number]
}

export const PROFILE_PRESETS: Record<string, ProfilePreset> = {
  dry_season: {
    name: 'Tối ưu mùa khô',
    tempCheckpoints: [
      { day: 1, value: 30 },
      { day: 7, value: 32 },
      { day: 14, value: 31 },
      { day: 21, value: 28 },
    ],
    humidityCheckpoints: [
      { day: 1, value: 75 },
      { day: 7, value: 85 },
      { day: 15, value: 80 },
      { day: 21, value: 70 },
    ],
    lightDaysActive: 8,
  },
  rainy_season: {
    name: 'Tối ưu mùa mưa',
    tempCheckpoints: [
      { day: 1, value: 28 },
      { day: 7, value: 30 },
      { day: 14, value: 29 },
      { day: 21, value: 27 },
    ],
    humidityCheckpoints: [
      { day: 1, value: 80 },
      { day: 7, value: 90 },
      { day: 15, value: 85 },
      { day: 21, value: 75 },
    ],
    lightDaysActive: 6,
  },
  quick_fruiting: {
    name: 'Kích quả nhanh',
    tempCheckpoints: [
      { day: 1, value: 31 },
      { day: 7, value: 33 },
      { day: 14, value: 30 },
      { day: 21, value: 29 },
    ],
    humidityCheckpoints: [
      { day: 1, value: 70 },
      { day: 7, value: 80 },
      { day: 15, value: 75 },
      { day: 21, value: 65 },
    ],
    lightDaysActive: 4,
  },
}

interface BatchContextType {
  profileKey: string
  profileName: string
  setProfileName: (name: string) => void
  loadProfilePreset: (key: string) => void
  totalCropDays: number
  updateTotalCropDaysAndScale: (days: number) => void
  temperatureCheckpoints: Checkpoint[]
  setTemperatureCheckpoints: (checkpoints: Checkpoint[]) => void
  humidityCheckpoints: Checkpoint[]
  setHumidityCheckpoints: (checkpoints: Checkpoint[]) => void
  lightDayStates: DayTrack[]
  setLightDayStates: (states: DayTrack[]) => void

  tempOptimalRange: [number, number]
  setTempOptimalRange: (range: [number, number]) => void
  humidityOptimalRange: [number, number]
  setHumidityOptimalRange: (range: [number, number]) => void

  // Derived getters
  spawnRunningEndDay: number
  getTemperatureSetpoint: (day: number) => number
  getHumiditySetpoint: (day: number) => number
  getIsLightActive: (day: number) => boolean
  activeBatchId: string | null
  activeBatchSyncVersion: number
  syncFromActiveBatch: (batch: ActiveBatch | null) => void
  customProfiles: Record<string, any>
  saveAsNewProfile: (name: string) => void
}

const BatchContext = createContext<BatchContextType | undefined>(undefined)

// Helper: Linear interpolation between curve checkpoints
function interpolateValue(day: number, checkpoints: Checkpoint[]): number {
  if (checkpoints.length === 0) return 0
  const sorted = [...checkpoints].sort((a, b) => a.day - b.day)
  
  if (day <= sorted[0].day) return sorted[0].value
  if (day >= sorted[sorted.length - 1].day) return sorted[sorted.length - 1].value
  
  for (let i = 0; i < sorted.length - 1; i++) {
    const p1 = sorted[i]
    const p2 = sorted[i + 1]
    if (day >= p1.day && day <= p2.day) {
      const ratio = (day - p1.day) / (p2.day - p1.day)
      return p1.value + ratio * (p2.value - p1.value)
    }
  }
  return sorted[0].value
}

// Helper: Scale checkpoints array to fit a new total number of crop days
function scaleCheckpointsHelper(
  checkpoints: Checkpoint[],
  oldTotalDays: number,
  clampedTotalDays: number
): Checkpoint[] {
  const sorted = [...checkpoints].sort((a, b) => a.day - b.day)
  if (sorted.length === 0) return []

  const scaled = sorted.map((cp) => {
    if (cp.day === 1) return cp
    if (cp.day === oldTotalDays) return { ...cp, day: clampedTotalDays }

    const newDay = 1 + Math.round(((cp.day - 1) * (clampedTotalDays - 1)) / (oldTotalDays - 1))
    const finalDay = Math.max(2, Math.min(clampedTotalDays - 1, newDay))
    return { ...cp, day: finalDay }
  })

  // Deduplicate by grouping by day and keeping the max value for safety (e.g., thermal stress warning)
  const result: Checkpoint[] = []
  scaled.forEach((current) => {
    const existing = result.find((item) => item.day === current.day)
    if (!existing) {
      result.push({ ...current })
    } else {
      existing.value = Math.max(existing.value, current.value)
    }
  })

  result.sort((a, b) => a.day - b.day)

  if (!result.some((cp) => cp.day === 1)) {
    result.unshift({ day: 1, value: checkpoints[0]?.value ?? 30 })
  }
  if (!result.some((cp) => cp.day === clampedTotalDays)) {
    result.push({
      day: clampedTotalDays,
      value: checkpoints[checkpoints.length - 1]?.value ?? 28,
    })
  }

  return result
}

export function BatchProvider({ children }: { children: React.ReactNode }) {
  const [profileKey, setProfileKey] = useState('dry_season')
  const [profileName, setProfileName] = useState('Tối ưu mùa khô')
  const [totalCropDays, setTotalCropDays] = useState(21)
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null)
  const [activeBatchSyncVersion, setActiveBatchSyncVersion] = useState(0)
  const [customProfiles, setCustomProfiles] = useState<Record<string, ProfilePreset>>({})

  // Load custom profiles from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('custom_mushroom_profiles')
    if (saved) {
      try {
        setCustomProfiles(JSON.parse(saved) as Record<string, ProfilePreset>)
      } catch (e) {
        console.error('Failed to parse custom profiles from localStorage:', e)
      }
    }
  }, [])

  const syncFromActiveBatch = useCallback((batch: ActiveBatch | null) => {
    if (!batch) {
      setActiveBatchId(null)
      setActiveBatchSyncVersion((version) => version + 1)
      return
    }

    setActiveBatchId(batch.id)
    setProfileName(batch.profileName)
    setTotalCropDays(batch.totalCropDays)

    const lightSchedule = batch.lightSchedule ?? []
    setLightDayStates(Array.from({ length: batch.totalCropDays }, (_, i) => {
      const day = i + 1
      const block = lightSchedule.find((item) => day >= item.startDay && day <= item.endDay)
      return { day, active: block ? block.status === 'ON' : day <= batch.spawnRunningEndDay }
    }))

    const tempCps = (batch.checkpoints || [])
      .filter((cp) => cp.metricType === 'TEMPERATURE')
      .sort((a, b) => a.cropDay - b.cropDay)
      .map((cp) => ({ day: cp.cropDay, value: cp.targetValue }))

    const humCps = (batch.checkpoints || [])
      .filter((cp) => cp.metricType === 'HUMIDITY')
      .sort((a, b) => a.cropDay - b.cropDay)
      .map((cp) => ({ day: cp.cropDay, value: cp.targetValue }))

    setTemperatureCheckpoints(tempCps)
    setHumidityCheckpoints(humCps)
    setActiveBatchSyncVersion((version) => version + 1)
  }, [])

  const [temperatureCheckpoints, setTemperatureCheckpoints] = useState<Checkpoint[]>([
    { day: 1, value: 30 },
    { day: 7, value: 32 },
    { day: 14, value: 31 },
    { day: 21, value: 28 },
  ])
  
  const [humidityCheckpoints, setHumidityCheckpoints] = useState<Checkpoint[]>([
    { day: 1, value: 75 },
    { day: 7, value: 85 },
    { day: 15, value: 80 },
    { day: 21, value: 70 },
  ])
  
  const [lightDayStates, setLightDayStates] = useState<DayTrack[]>(
    Array.from({ length: 21 }, (_, i) => ({
      day: i + 1,
      active: i < 8, // Days 1-8 are ON
    }))
  )


  const [tempOptimalRange, setTempOptimalRange] = useState<[number, number]>([28, 35])
  const [humidityOptimalRange, setHumidityOptimalRange] = useState<[number, number]>([70, 90])

  // Derive biological spawnRunningEndDay (end of the first active phase / block)
  const spawnRunningEndDay = useMemo(() => {
    const firstOffIndex = lightDayStates.findIndex((state) => !state.active)
    if (firstOffIndex === -1) return totalCropDays
    if (firstOffIndex === 0) {
      const firstOnIndex = lightDayStates.findIndex((state) => state.active)
      return firstOnIndex !== -1 ? firstOnIndex : 8
    }
    return firstOffIndex
  }, [lightDayStates, totalCropDays])

  // Loads a preset profile and scales it to current totalCropDays
  const loadProfilePreset = (key: string) => {
    const preset = PROFILE_PRESETS[key as keyof typeof PROFILE_PRESETS] || customProfiles[key]
    if (!preset) return
    setProfileKey(key)
    setProfileName(preset.name)

    const targetDays = preset.totalCropDays || 21
    setTotalCropDays(targetDays)

    const presetTotalDays = preset.totalCropDays || 21

    const scale = (checkpoints: Checkpoint[]) => {
      const scaled = checkpoints.map(cp => {
        if (cp.day === 1) return cp
        if (cp.day === presetTotalDays) return { ...cp, day: targetDays }
        const newDay = 1 + Math.round((cp.day - 1) * (targetDays - 1) / (presetTotalDays - 1))
        return { ...cp, day: Math.max(2, Math.min(targetDays - 1, newDay)) }
      })

      // Deduplicate by grouping by day and keeping the max value for safety (e.g., thermal stress warning)
      const result: Checkpoint[] = []
      scaled.forEach((current) => {
        const existing = result.find((item) => item.day === current.day)
        if (!existing) {
          result.push({ ...current })
        } else {
          existing.value = Math.max(existing.value, current.value)
        }
      })

      result.sort((a, b) => a.day - b.day)

      if (!result.some((cp) => cp.day === 1)) {
        result.unshift({ day: 1, value: checkpoints[0]?.value ?? 30 })
      }
      if (!result.some((cp) => cp.day === targetDays)) {
        result.push({ day: targetDays, value: checkpoints[checkpoints.length - 1]?.value ?? 28 })
      }

      return result
    }

    setTemperatureCheckpoints(scale(preset.tempCheckpoints))
    setHumidityCheckpoints(scale(preset.humidityCheckpoints))

    const lightDaysActive = preset.lightDaysActive || 8
    setLightDayStates(Array.from({ length: targetDays }, (_, i) => {
      const day = i + 1
      const oldDay = 1 + Math.round((day - 1) * (presetTotalDays - 1) / (targetDays - 1))
      return {
        day,
        active: oldDay <= lightDaysActive,
      }
    }))

    if (preset.tempOptimalRange) setTempOptimalRange(preset.tempOptimalRange)
    if (preset.humidityOptimalRange) setHumidityOptimalRange(preset.humidityOptimalRange)
  }

  // Transactionally scale total crop days and all checkpoints/schedules
  const updateTotalCropDaysAndScale = (newTotalDays: number) => {
    const clampedTotalDays = Math.max(10, Math.min(45, newTotalDays))
    const oldTotalDays = totalCropDays
    if (clampedTotalDays === oldTotalDays) return

    setTotalCropDays(clampedTotalDays)

    setTemperatureCheckpoints((prev) =>
      scaleCheckpointsHelper(prev, oldTotalDays, clampedTotalDays),
    )
    setHumidityCheckpoints((prev) =>
      scaleCheckpointsHelper(prev, oldTotalDays, clampedTotalDays),
    )

    setLightDayStates((prev) => {
      return Array.from({ length: clampedTotalDays }, (_, i) => {
        const day = i + 1
        const oldDay = 1 + Math.round(((day - 1) * (oldTotalDays - 1)) / (clampedTotalDays - 1))
        const oldState = prev.find((s) => s.day === oldDay)
        return {
          day,
          active: oldState ? oldState.active : day <= 8,
        }
      })
    })
  }

  const saveAsNewProfile = useCallback((name: string) => {
    const key = `custom_${Date.now()}`
    const newPreset = {
      name,
      tempCheckpoints: [...temperatureCheckpoints],
      humidityCheckpoints: [...humidityCheckpoints],
      lightDaysActive: spawnRunningEndDay,
      totalCropDays,
      tempOptimalRange,
      humidityOptimalRange,
    }
    const updated = { ...customProfiles, [key]: newPreset }
    setCustomProfiles(updated)
    localStorage.setItem('custom_mushroom_profiles', JSON.stringify(updated))
    setProfileKey(key)
    setProfileName(name)
  }, [
    temperatureCheckpoints,
    humidityCheckpoints,
    spawnRunningEndDay,
    totalCropDays,
    tempOptimalRange,
    humidityOptimalRange,
    customProfiles,
  ])

  const getTemperatureSetpoint = (day: number) => {
    return interpolateValue(day, temperatureCheckpoints)
  }

  const getHumiditySetpoint = (day: number) => {
    return interpolateValue(day, humidityCheckpoints)
  }

  const getIsLightActive = (day: number) => {
    const state = lightDayStates.find((s) => s.day === day)
    return state ? state.active : false
  }

  return (
    <BatchContext.Provider
      value={{
        profileKey,
        profileName,
        setProfileName,
        loadProfilePreset,
        totalCropDays,
        updateTotalCropDaysAndScale,
        temperatureCheckpoints,
        setTemperatureCheckpoints,
        humidityCheckpoints,
        setHumidityCheckpoints,
        lightDayStates,
        setLightDayStates,
        tempOptimalRange,
        setTempOptimalRange,
        humidityOptimalRange,
        setHumidityOptimalRange,
        spawnRunningEndDay,
        getTemperatureSetpoint,
        getHumiditySetpoint,
        getIsLightActive,
        activeBatchId,
        activeBatchSyncVersion,
        syncFromActiveBatch,
        customProfiles,
        saveAsNewProfile,
      }}
    >
      {children}
    </BatchContext.Provider>
  )
}

export function useBatch() {
  const context = useContext(BatchContext)
  if (context === undefined) {
    throw new Error('useBatch must be used within a BatchProvider')
  }
  return context
}
