'use client'

import React from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { formatPhoneNumber } from '@/lib/kiosk-storage'
import { ArrowLeft, Shield, Users, Home, Cpu, LogOut } from 'lucide-react'

interface AdminLayoutProps {
  activeTab: 'users' | 'houses' | 'devices'
  onTabChange: (tab: 'users' | 'houses' | 'devices') => void
  children: React.ReactNode
}

export function AdminLayout({ activeTab, onTabChange, children }: AdminLayoutProps) {
  const { user, logout } = useAuth()

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 backdrop-blur-xl px-4 py-3.5 sm:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <Link
              href="/"
              className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/80 px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-slate-200 hover:border-slate-700 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <ArrowLeft className="size-4" />
              <span>Về Bảng Điều Khiển</span>
            </Link>
            <div className="h-6 w-px bg-slate-800 hidden sm:block" />
            <div className="flex items-center gap-2.5">
              <div className="flex size-10 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-950/50 text-emerald-400 shadow-sm">
                <Shield className="size-5" />
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-white">
                  Quản Trị Hệ Thống
                </h1>
                <p className="text-xs font-medium text-emerald-400">
                  AgriSmart Nấm Rơm
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3.5">
            <div className="hidden text-right md:block">
              <p className="text-sm font-bold text-slate-100">{formatPhoneNumber(user?.phoneNumber ?? '')}</p>
              <span className="inline-flex items-center rounded-md border border-emerald-500/40 bg-emerald-950/60 px-2.5 py-0.5 text-xs font-bold text-emerald-300">
                {user?.role === 'ADMIN' ? 'Quản Trị Viên' : user?.role === 'OPERATOR' ? 'Nông Dân' : user?.role}
              </span>
            </div>
            <button
              type="button"
              onClick={() => logout()}
              className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-2.5 text-xs sm:text-sm font-semibold text-red-200 hover:bg-red-900/60 transition-colors"
              title="Đăng xuất"
            >
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Đăng xuất</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-8">
        {/* Navigation Tabs */}
        <div className="mb-6 flex border-b border-slate-800 overflow-x-auto">
          <button
            type="button"
            onClick={() => onTabChange('users')}
            className={`flex min-h-[48px] cursor-pointer items-center gap-2.5 border-b-2 px-6 py-3 text-sm sm:text-base font-bold transition-colors whitespace-nowrap ${
              activeTab === 'users'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-950/30'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <Users className="size-5" />
            <span>Người Dùng</span>
          </button>
          <button
            type="button"
            onClick={() => onTabChange('houses')}
            className={`flex min-h-[48px] cursor-pointer items-center gap-2.5 border-b-2 px-6 py-3 text-sm sm:text-base font-bold transition-colors whitespace-nowrap ${
              activeTab === 'houses'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-950/30'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <Home className="size-5" />
            <span>Nhà Nấm</span>
          </button>
          <button
            type="button"
            onClick={() => onTabChange('devices')}
            className={`flex min-h-[48px] cursor-pointer items-center gap-2.5 border-b-2 px-6 py-3 text-sm sm:text-base font-bold transition-colors whitespace-nowrap ${
              activeTab === 'devices'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-950/30'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <Cpu className="size-5" />
            <span>Thiết Bị IoT</span>
          </button>
        </div>

        {/* Tab Content */}
        <main>{children}</main>
      </div>
    </div>
  )
}
