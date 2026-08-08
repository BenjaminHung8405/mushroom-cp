'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminProfilesRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/profile')
  }, [router])

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-300">
      <div className="size-12 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 animate-spin mb-4" />
      <p className="font-mono text-sm">Đang chuyển hướng đến trang Quản lý Profile…</p>
    </div>
  )
}
