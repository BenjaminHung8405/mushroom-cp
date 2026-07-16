'use client'

import { useEffect, useState } from 'react'

export function CountdownBadge({ secondsRemaining, intent }: {
  secondsRemaining: number
  intent: 'auto' | 'on' | 'off'
}) {
  const [remaining, setRemaining] = useState(secondsRemaining)

  useEffect(() => {
    setRemaining(secondsRemaining)
  }, [secondsRemaining])

  useEffect(() => {
    if (intent === 'auto' || remaining <= 0) return
    const timer = window.setInterval(() => {
      setRemaining((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [intent, remaining > 0])

  if (intent === 'auto' || remaining <= 0) return null

  const mins = Math.floor(remaining / 60)
  const secs = remaining % 60
  const text = `${mins}:${secs.toString().padStart(2, '0')}`

  return (
    <div
      className={`min-w-20 text-center px-2 py-1 rounded-full text-[10px] font-bold tracking-wide border ${
        intent === 'on'
          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
          : 'bg-red-500/20 text-red-300 border-red-500/25'
      }`}
    >
      {text}
    </div>
  )
}
