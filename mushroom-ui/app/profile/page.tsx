'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { authApi } from '@/lib/auth-api'
import { kioskStorage, formatPhoneNumber } from '@/lib/kiosk-storage'
import { AvatarPicker, AgricultureAvatars } from '@/app/components/kiosk/AvatarPicker'
import { PinNumpad } from '@/app/components/kiosk/PinNumpad'
import {
  ArrowLeft,
  User,
  Key,
  Tablet,
  CheckCircle2,
  AlertCircle,
  Lock,
  Trash2,
  PlusCircle,
  Save,
  LogOut,
} from 'lucide-react'

type TabType = 'profile' | 'pin' | 'kiosk'
type PinChangeStep = 'current_pin' | 'new_pin' | 'confirm_pin' | 'success'

export default function ProfilePage() {
  const { user, status, updateProfile, logout } = useAuth()
  const router = useRouter()

  // Tab State
  const [activeTab, setActiveTab] = useState<TabType>('profile')

  // Tab 1: Profile Form State
  const [fullName, setFullName] = useState(user?.fullName || '')
  const [selectedAvatarId, setSelectedAvatarId] = useState<string>(user?.avatar || 'sprout')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Tab 2: PIN Change State
  const [pinStep, setPinStep] = useState<PinChangeStep>('current_pin')
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [pinLoading, setPinLoading] = useState(false)

  // Tab 3: Kiosk Device State
  const [deviceToken, setDeviceToken] = useState<string | null>(null)
  const [isPinned, setIsPinned] = useState(false)
  const [kioskActionLoading, setKioskActionLoading] = useState(false)
  const [kioskMsg, setKioskMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login?redirect=/profile')
    } else if (user) {
      setFullName(user.fullName || '')
      setSelectedAvatarId(user.avatar || 'sprout')
      setDeviceToken(kioskStorage.getDeviceToken())
      setIsPinned(kioskStorage.hasRegisteredUser(user.id))
    }
  }, [status, user, router])

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-300">
        <div className="size-12 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 animate-spin mb-4" />
        <p className="font-mono text-sm">Đang tải thông tin cá nhân…</p>
      </div>
    )
  }

  if (status === 'unauthenticated' || !user) {
    return null
  }

  const currentAvatarPreset = AgricultureAvatars.find((a) => a.id === selectedAvatarId) || AgricultureAvatars[0]
  const AvatarIcon = currentAvatarPreset.icon

  // Handlers
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setProfileSaving(true)
    setProfileMsg(null)
    try {
      await updateProfile({
        fullName: fullName.trim(),
        avatar: selectedAvatarId,
      })
      setProfileMsg({ type: 'success', text: 'Cập nhật thông tin cá nhân thành công!' })
    } catch (err: any) {
      setProfileMsg({ type: 'error', text: err.message || 'Không thể lưu thông tin cá nhân.' })
    } finally {
      setProfileSaving(false)
    }
  }

  const handleCurrentPinComplete = (pin: string) => {
    setCurrentPin(pin)
    setPinError(null)
    setPinStep('new_pin')
  }

  const handleNewPinComplete = (pin: string) => {
    setNewPin(pin)
    setPinError(null)
    setPinStep('confirm_pin')
  }

  const handleConfirmPinComplete = async (confirmPin: string) => {
    if (confirmPin !== newPin) {
      setPinError('Mã PIN xác nhận không khớp. Vui lòng nhập lại.')
      return
    }
    setPinError(null)
    setPinLoading(true)
    try {
      await authApi.setPin(currentPin, newPin)
      setPinStep('success')
      setTimeout(() => {
        logout()
      }, 2000)
    } catch (err: any) {
      setPinError(err.message || 'Lỗi khi đổi mã PIN.')
      setPinStep('current_pin')
      setCurrentPin('')
      setNewPin('')
    } finally {
      setPinLoading(false)
    }
  }

  const resetPinForm = () => {
    setPinStep('current_pin')
    setCurrentPin('')
    setNewPin('')
    setPinError(null)
  }

  const handleRevokeDevice = async () => {
    if (!deviceToken || !user) return
    if (!confirm('Bạn có chắc chắn muốn hủy ghim thiết bị này khỏi tài khoản không?')) return

    setKioskActionLoading(true)
    setKioskMsg(null)
    try {
      await authApi.pinRevoke(deviceToken)
      kioskStorage.removeRegisteredUser(user.id)
      setIsPinned(false)
      setKioskMsg({ type: 'success', text: 'Đã hủy ghim thiết bị thành công!' })
    } catch (err: any) {
      setKioskMsg({ type: 'error', text: err.message || 'Lỗi khi hủy ghim thiết bị.' })
    } finally {
      setKioskActionLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Navigation Topbar */}
      <header className="sticky top-0 z-40 border-b border-slate-800/90 bg-slate-950/95 backdrop-blur-xl px-4 py-3 sm:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
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
                <User className="size-5" />
              </div>
              <h1 className="font-mono text-sm font-bold tracking-tight text-white sm:text-base">
                Quản Lý Profile & Mã PIN Cá Nhân
              </h1>
            </div>
          </div>

          <button
            type="button"
            onClick={() => logout()}
            className="flex items-center gap-1.5 min-h-11 px-3 py-2 rounded-xl border border-red-500/30 bg-red-950/30 text-red-300 hover:bg-red-900/50 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
            title="Đăng xuất khỏi tài khoản"
          >
            <LogOut className="size-4" />
            <span className="hidden sm:inline">Đăng xuất</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 space-y-6">
        {/* Banner Banner / User Info */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md shadow-xl flex items-center gap-4">
          <div className={`size-16 rounded-2xl bg-gradient-to-br ${currentAvatarPreset.gradient} p-0.5 shadow-lg flex items-center justify-center shrink-0`}>
            <div className="size-full bg-slate-950/40 rounded-[14px] flex items-center justify-center">
              <AvatarIcon className="size-8 text-white" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-white truncate">
              {user.fullName || formatPhoneNumber(user.phoneNumber)}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="font-mono text-xs text-slate-400">
                {formatPhoneNumber(user.phoneNumber)}
              </span>
              <span
                className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-bold ${
                  user.role === 'ADMIN'
                    ? 'border border-purple-500/40 bg-purple-950/40 text-purple-300'
                    : user.role === 'OPERATOR'
                    ? 'border border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                    : 'border border-blue-500/40 bg-blue-950/40 text-blue-300'
                }`}
              >
                {user.role === 'ADMIN' ? 'Quản Trị Viên' : user.role === 'OPERATOR' ? 'Master Operator' : 'Kiểm Toán Viên'}
              </span>
            </div>
          </div>
        </div>

        {/* Tab Selection Navigation */}
        <div className="grid grid-cols-3 gap-2 p-1.5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg">
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`flex items-center justify-center gap-2 py-3 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              activeTab === 'profile'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/50'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <User className="size-4" />
            <span>Hồ sơ cá nhân</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('pin')
              resetPinForm()
            }}
            className={`flex items-center justify-center gap-2 py-3 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              activeTab === 'pin'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/50'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Key className="size-4" />
            <span>Đổi mã PIN 6 số</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('kiosk')}
            className={`flex items-center justify-center gap-2 py-3 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
              activeTab === 'kiosk'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/50'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Tablet className="size-4" />
            <span>Ghim Kiosk</span>
          </button>
        </div>

        {/* Tab 1: Profile Information */}
        {activeTab === 'profile' && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 backdrop-blur-md shadow-xl space-y-5">
            <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider flex items-center gap-2">
              <User className="size-4 text-emerald-400" />
              <span>Chỉnh sửa thông tin cá nhân & Avatar</span>
            </h3>

            {profileMsg && (
              <div
                className={`flex items-center gap-2.5 p-3.5 rounded-xl border text-xs font-medium ${
                  profileMsg.type === 'success'
                    ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
                    : 'border-red-500/40 bg-red-950/40 text-red-200'
                }`}
              >
                {profileMsg.type === 'success' ? (
                  <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="size-4 text-red-400 shrink-0" />
                )}
                <span>{profileMsg.text}</span>
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  Họ và tên người vận hành:
                </label>
                <input
                  type="text"
                  placeholder="Nhập họ và tên (VD: Nguyễn Văn Nông)"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  maxLength={100}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-colors"
                />
              </div>

              {/* Avatar Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  Biểu tượng Avatar Nông nghiệp đại diện:
                </label>
                <AvatarPicker
                  selectedId={selectedAvatarId}
                  onSelect={(preset) => setSelectedAvatarId(preset.id)}
                />
              </div>

              <button
                type="submit"
                disabled={profileSaving}
                className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors shadow-lg shadow-emerald-950/50 cursor-pointer disabled:opacity-50 active:scale-[0.98]"
              >
                <Save className="size-4" />
                <span>{profileSaving ? 'Đang lưu…' : 'Lưu Thay Đổi Thông Tin'}</span>
              </button>
            </form>
          </div>
        )}

        {/* Tab 2: Change Account PIN */}
        {activeTab === 'pin' && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 backdrop-blur-md shadow-xl space-y-5">
            <div>
              <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider flex items-center gap-2">
                <Key className="size-4 text-emerald-400" />
                <span>Đổi Mã PIN Tài Khoản (Mật Khẩu Đăng Nhập)</span>
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Mã PIN 6 số là mật khẩu chính dùng để đăng nhập SĐT và Kiosk.
              </p>
            </div>

            {pinStep !== 'success' && (
              <div className="flex items-center justify-between px-4 py-3 rounded-2xl border border-slate-800 bg-slate-900/60">
                <div className={`flex items-center gap-2 text-xs font-mono font-bold ${pinStep === 'current_pin' ? 'text-emerald-400' : 'text-slate-400'}`}>
                  <span className={`size-6 rounded-full flex items-center justify-center text-[11px] ${pinStep === 'current_pin' ? 'bg-emerald-500 text-slate-950 font-extrabold' : 'bg-slate-800 text-slate-300'}`}>1</span>
                  <span>PIN Hiện Tại</span>
                </div>
                <div className="h-0.5 w-6 bg-slate-800" />
                <div className={`flex items-center gap-2 text-xs font-mono font-bold ${pinStep === 'new_pin' ? 'text-emerald-400' : 'text-slate-400'}`}>
                  <span className={`size-6 rounded-full flex items-center justify-center text-[11px] ${pinStep === 'new_pin' ? 'bg-emerald-500 text-slate-950 font-extrabold' : 'bg-slate-800 text-slate-300'}`}>2</span>
                  <span>PIN Mới</span>
                </div>
                <div className="h-0.5 w-6 bg-slate-800" />
                <div className={`flex items-center gap-2 text-xs font-mono font-bold ${pinStep === 'confirm_pin' ? 'text-emerald-400' : 'text-slate-400'}`}>
                  <span className={`size-6 rounded-full flex items-center justify-center text-[11px] ${pinStep === 'confirm_pin' ? 'bg-emerald-500 text-slate-950 font-extrabold' : 'bg-slate-800 text-slate-300'}`}>3</span>
                  <span>Xác Nhận</span>
                </div>
              </div>
            )}

            {pinStep === 'current_pin' && (
              <div>
                <p className="text-center text-xs text-slate-300 font-medium mb-4">
                  Nhập mã PIN 6 số hiện tại của bạn:
                </p>
                <PinNumpad
                  onComplete={handleCurrentPinComplete}
                  disabled={pinLoading}
                  error={pinError}
                />
              </div>
            )}

            {pinStep === 'new_pin' && (
              <div>
                <p className="text-center text-xs text-slate-300 font-medium mb-4">
                  Nhập mã PIN 6 số mới dễ nhớ:
                </p>
                <PinNumpad
                  onComplete={handleNewPinComplete}
                  disabled={pinLoading}
                  error={pinError}
                />
              </div>
            )}

            {pinStep === 'confirm_pin' && (
              <div>
                <p className="text-center text-xs text-slate-300 font-medium mb-4">
                  Nhập lại mã PIN mới để xác nhận:
                </p>
                <PinNumpad
                  onComplete={handleConfirmPinComplete}
                  disabled={pinLoading}
                  error={pinError}
                />
              </div>
            )}

            {pinStep === 'success' && (
              <div className="flex flex-col items-center justify-center py-8 text-center motion-safe:animate-fade-in">
                <div className="size-16 rounded-full bg-emerald-950 border-2 border-emerald-400 text-emerald-400 flex items-center justify-center mb-3 shadow-[0_0_15px_rgba(34,197,94,0.3)]">
                  <CheckCircle2 className="size-10" />
                </div>
                <h4 className="text-base font-bold text-emerald-300 font-mono">
                  Đổi mã PIN thành công!
                </h4>
                <p className="mt-1.5 text-xs text-slate-400">
                  Hệ thống sẽ tự động đăng xuất để bạn bảo mật tài khoản bằng mã PIN mới.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Kiosk Binding */}
        {activeTab === 'kiosk' && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 backdrop-blur-md shadow-xl space-y-5">
            <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider flex items-center gap-2">
              <Tablet className="size-4 text-emerald-400" />
              <span>Quản lý Ghim Thiết bị Kiosk</span>
            </h3>

            {kioskMsg && (
              <div
                className={`flex items-center gap-2.5 p-3.5 rounded-xl border text-xs font-medium ${
                  kioskMsg.type === 'success'
                    ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
                    : 'border-red-500/40 bg-red-950/40 text-red-200'
                }`}
              >
                {kioskMsg.type === 'success' ? (
                  <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="size-4 text-red-400 shrink-0" />
                )}
                <span>{kioskMsg.text}</span>
              </div>
            )}

            {isPinned ? (
              <div className="space-y-4">
                <div className="p-5 rounded-2xl border border-emerald-500/40 bg-emerald-950/30 flex items-start gap-4">
                  <div className="size-12 rounded-xl bg-emerald-900/50 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                    <Lock className="size-6" />
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-emerald-300 font-mono">
                      Máy tính bảng này đã được ghim an toàn
                    </h4>
                    <p className="mt-1.5 text-xs text-slate-300 leading-relaxed">
                      Lần sau trên máy này, bạn có thể đăng nhập cực nhanh bằng cách chọn ảnh đại diện và nhập 6 số PIN.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleRevokeDevice}
                  disabled={kioskActionLoading}
                  className="w-full py-3.5 px-4 rounded-xl border border-red-500/40 bg-red-950/50 text-red-300 hover:bg-red-900/60 font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50 active:scale-[0.98]"
                >
                  <Trash2 className="size-4" />
                  <span>{kioskActionLoading ? 'Đang hủy…' : 'Xóa & Hủy ghim thiết bị này'}</span>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-6 rounded-2xl border border-emerald-800/40 bg-emerald-950/30 text-center">
                  <p className="text-sm font-semibold text-emerald-300 mb-1">Đăng nhập lần đầu bằng SĐT để kích hoạt</p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Sau khi đăng nhập bằng Số điện thoại, thiết bị này sẽ tự động được ghim.
                    Lần sau bạn chỉ cần chọn ảnh và nhập PIN.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

    </div>
  )
}
