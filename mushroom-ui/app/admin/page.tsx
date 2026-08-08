'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { AdminLayout } from './components/AdminLayout'
import { UsersTab } from './components/UsersTab'
import { HousesTab } from './components/HousesTab'
import { DevicesTab } from './components/DevicesTab'

export default function AdminPage() {
  const { user, status } = useAuth()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'users' | 'houses' | 'devices'>('users')

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login?redirect=/admin')
    } else if (status === 'authenticated' && user?.role !== 'ADMIN') {
      router.replace('/')
    }
  }, [status, user, router])

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-300">
        <div className="size-12 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 animate-spin mb-4" />
        <p className="font-mono text-sm">Đang xác thực quyền Admin…</p>
      </div>
    )
  }

  if (status === 'unauthenticated' || user?.role !== 'ADMIN') {
    return null
  }

  return (
    <AdminLayout activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === 'users' && <UsersTab />}
      {activeTab === 'houses' && <HousesTab />}
      {activeTab === 'devices' && <DevicesTab />}
    </AdminLayout>
  )
}
