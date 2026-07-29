'use client'

import type { RefObject, ReactNode } from 'react'

import { Header } from './header'

interface DashboardLayoutProps {
  children: ReactNode
  onOpenAlerts: () => void
  activeAlertCount: number
  alertTriggerRef: RefObject<HTMLButtonElement | null>
}

export function DashboardLayout({ children, onOpenAlerts, activeAlertCount, alertTriggerRef }: DashboardLayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <Header onOpenAlerts={onOpenAlerts} activeAlertCount={activeAlertCount} alertTriggerRef={alertTriggerRef} />
      <main className="min-h-0 pb-[calc(80px+env(safe-area-inset-bottom))] md:pb-8">
        <div className="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-5 sm:py-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  )
}
