'use client'

import { useEffect, useState } from 'react'

function formatAge(timestamp: string, now: number): string {
  const ageSeconds = Math.max(0, Math.floor((now - new Date(timestamp).getTime()) / 1000))
  if (!Number.isFinite(ageSeconds)) return 'không rõ thời điểm'
  if (ageSeconds < 5) return 'vừa xong'
  if (ageSeconds < 60) return `${ageSeconds} giây trước`
  const minutes = Math.floor(ageSeconds / 60)
  if (minutes < 60) return `${minutes} phút trước`
  return `${Math.floor(minutes / 60)} giờ trước`
}

export function DataAgeTicker({ timestamp }: { timestamp: string | null }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!timestamp) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [timestamp])

  if (!timestamp) return <>Chưa nhận được</>
  return <>{formatAge(timestamp, now)}</>
}
