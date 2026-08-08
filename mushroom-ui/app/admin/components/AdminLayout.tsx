'use client'

import React from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
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
      <header className="sticky top-0 z-40 border-b border-slate-800/90 bg-slate-950/95 backdrop-blur-xl px-4 py-3 sm:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-slate-700 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <ArrowLeft className="size-4" />
              <span>Về Bảng Điều Khiển</span>
            </Link>
            <div className="h-5 w-px bg-slate-800 hidden sm:block" />
            <div className="flex items-center gap-2">
              <div className="flex size-9 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-950/40 text-emerald-400 shadow-sm">
                <Shield className="size-5" />
              </div>
              <div>
                <h1 className="font-mono text-sm font-bold tracking-tight text-white sm:text-base">
                  Quản Trị Hệ Thống
                </h1>
                <p className="text-[10px] uppercase font-mono tracking-wider text-slate-400">
                  AgriSmart Admin Panel
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right md:block">
              <p className="text-xs font-semibold text-slate-200">{user?.phoneNumber}</p>
              <span className="inline-flex items-center rounded-md border border-emerald-500/30 bg-emerald-950/50 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                {user?.role}
              </span>
            </div>
            <button
              type="button"
              onClick={() => logout()}
              className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-950/30 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-900/50 transition-colors"
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
        <div className="mb-6 flex border-b border-slate-800">
          <button
            type="button"
            onClick={() => onTabChange('users')}
            className={`flex min-h-11 cursor-pointer items-center gap-2 border-b-2 px-5 py-3 text-sm font-semibold transition-colors ${
              activeTab === 'users'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-950/20'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <Users className="size-4" />
            <span>Người Dùng</span>
          </button>
          <button
            type="button"
            onClick={() => onTabChange('houses')}
            className={`flex min-h-11 cursor-pointer items-center gap-2 border-b-2 px-5 py-3 text-sm font-semibold transition-colors ${
              activeTab === 'houses'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-950/20'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <Home className="size-4" />
            <span>Nhà Nấm</span>
          </button>
          <button
            type="button"
            onClick={() => onTabChange('devices')}
            className={`flex min-h-11 cursor-pointer items-center gap-2 border-b-2 px-5 py-3 text-sm font-semibold transition-colors ${
              activeTab === 'devices'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-950/20'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <Cpu className="size-4" />
            <span>Thiết Bị (Devices)</span>
          </button>
        </div>

        {/* Tab Content */}
        <main>{children}</main>
      </div>
    </div>
  )
}
