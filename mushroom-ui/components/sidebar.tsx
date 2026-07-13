'use client'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { LayoutGrid, Leaf, Library, Menu, Settings, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

const navItems = [
  { name: 'Tổng quan', href: '/', icon: LayoutGrid },
  { name: 'Khu trồng', href: '/farms', icon: Leaf },
  { name: 'Mẫu điều kiện trồng', href: '/library', icon: Library },
  { name: 'Cài đặt', href: '/settings', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      {/* Mobile Menu Button */}
      <Button
        variant="ghost"
        size="icon"
        className="fixed top-4 left-4 z-40 lg:hidden"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <X size={24} /> : <Menu size={24} />}
      </Button>

      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 h-screen w-64 bg-sidebar border-r border-sidebar-border z-40 transition-transform duration-300 ease-in-out flex flex-col',
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Logo Section */}
        <div className="flex items-center gap-3 p-6 border-b border-sidebar-border">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
            <Leaf className="w-6 h-6 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-sidebar-foreground">NẤM RƠM CP</h1>
            <p className="text-xs text-sidebar-foreground/60">Theo dõi nhà nấm</p>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav className="flex-1 overflow-y-auto py-6 px-3">
          <ul className="space-y-2">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setIsOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors duration-200',
                      isActive
                        ? 'bg-sidebar-primary text-sidebar-primary-foreground font-semibold'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                    )}
                  >
                    <Icon size={20} />
                    <span>{item.name}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Footer Section */}
        <div className="border-t border-sidebar-border p-4">
          <div className="bg-sidebar-accent/20 rounded-lg p-4 text-center">
            <p className="text-sm text-sidebar-foreground/75 mb-3">
              Khu trồng: <span className="font-semibold text-emerald-400">1</span> (35 trụ)
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full border-emerald-500/50 text-emerald-400 hover:bg-emerald-500 hover:text-white"
            >
              Thêm khu trồng
            </Button>
          </div>
        </div>
      </aside>

      {/* Desktop Spacer */}
      <div className="hidden lg:block w-64" />
    </>
  )
}
