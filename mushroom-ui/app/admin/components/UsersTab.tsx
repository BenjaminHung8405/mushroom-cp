'use client'

import React, { useEffect, useState } from 'react'
import { adminApi, type AdminUser, type AdminHouse } from '@/lib/admin-api'
import { formatPhoneNumber } from '@/lib/kiosk-storage'
import { UserPlus, Edit3, Key, Home, RefreshCw, AlertCircle, Check, X, Eye, EyeOff } from 'lucide-react'

export function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [houses, setHouses] = useState<AdminHouse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Modal error state (displays INSIDE modals)
  const [modalError, setModalError] = useState<string | null>(null)

  // Dialog states
  const [createOpen, setCreateOpen] = useState(false)
  const [editUser, setEditUser] = useState<AdminUser | null>(null)
  const [resetPinUser, setResetPinUser] = useState<AdminUser | null>(null)
  const [accessUser, setAccessUser] = useState<AdminUser | null>(null)

  // PIN visibility toggles
  const [showNewPin, setShowNewPin] = useState(false)
  const [showEditPin, setShowEditPin] = useState(false)
  const [showResetPin, setShowResetPin] = useState(false)

  // Form inputs
  const [newPhone, setNewPhone] = useState('')
  const [newPin, setNewPin] = useState('')
  const [newRole, setNewRole] = useState<'ADMIN' | 'OPERATOR' | 'AUDITOR'>('OPERATOR')

  const [editRole, setEditRole] = useState<'ADMIN' | 'OPERATOR' | 'AUDITOR'>('OPERATOR')
  const [editActive, setEditActive] = useState(true)
  const [editPin, setEditPin] = useState('')

  const [resetPinValue, setResetPinValue] = useState('')
  const [selectedHouseIds, setSelectedHouseIds] = useState<string[]>([])

  const [submitting, setSubmitting] = useState(false)

  const fetchData = async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const [uData, hData] = await Promise.all([
        adminApi.listUsers(signal),
        adminApi.listHouses(signal),
      ])
      setUsers(uData)
      setHouses(hData.data)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách người dùng.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    fetchData(controller.signal)
    return () => {
      controller.abort()
    }
  }, [])

  const resetModalState = () => {
    setModalError(null)
    setShowNewPin(false)
    setShowEditPin(false)
    setShowResetPin(false)
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setModalError(null)
    setError(null)
    setSuccessMsg(null)
    try {
      await adminApi.createUser({
        phoneNumber: newPhone,
        pin: newPin,
        role: newRole,
      })
      setSuccessMsg(`Tạo tài khoản ${formatPhoneNumber(newPhone)} thành công!`)
      setCreateOpen(false)
      setNewPhone('')
      setNewPin('')
      fetchData()
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : 'Lỗi khi tạo người dùng.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editUser) return
    setSubmitting(true)
    setModalError(null)
    setError(null)
    setSuccessMsg(null)
    try {
      await adminApi.updateUser(editUser.id, {
        role: editRole,
        isActive: editActive,
        newPin: editPin || undefined,
      })
      setSuccessMsg(`Cập nhật người dùng ${formatPhoneNumber(editUser.phoneNumber)} thành công!`)
      setEditUser(null)
      fetchData()
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : 'Lỗi khi cập nhật người dùng.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleResetPin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resetPinUser) return
    setSubmitting(true)
    setModalError(null)
    setError(null)
    setSuccessMsg(null)
    try {
      await adminApi.resetPin(resetPinUser.id, resetPinValue)
      setSuccessMsg(`Đã đặt lại PIN cho ${formatPhoneNumber(resetPinUser.phoneNumber)}!`)
      setResetPinUser(null)
      setResetPinValue('')
      fetchData()
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : 'Lỗi khi đặt lại PIN.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSaveHouseAccess = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!accessUser) return
    setSubmitting(true)
    setModalError(null)
    setError(null)
    setSuccessMsg(null)
    try {
      await adminApi.setHouseAccess(accessUser.id, selectedHouseIds)
      setSuccessMsg(`Cập nhật quyền truy cập nhà nấm cho ${formatPhoneNumber(accessUser.phoneNumber)} thành công!`)
      setAccessUser(null)
      fetchData()
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : 'Lỗi khi phân quyền nhà nấm.')
    } finally {
      setSubmitting(false)
    }
  }

  const openCreateModal = () => {
    resetModalState()
    setCreateOpen(true)
  }

  const openEditModal = (u: AdminUser) => {
    resetModalState()
    setEditUser(u)
    setEditRole(u.role)
    setEditActive(u.isActive)
    setEditPin('')
  }

  const openResetPinModal = (u: AdminUser) => {
    resetModalState()
    setResetPinUser(u)
    setResetPinValue('')
  }

  const openAccessModal = (u: AdminUser) => {
    resetModalState()
    setAccessUser(u)
    setSelectedHouseIds([])
  }

  return (
    <div className="space-y-6 font-sans">
      {/* Header bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Quản Lý Tài Khoản Người Dùng</h2>
          <p className="text-xs sm:text-sm text-slate-400">Danh sách tài khoản Nông dân (Operator), Giám sát (Auditor) & Quản trị viên (Admin)</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => fetchData()}
            className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className="size-4" />
            <span>Làm mới</span>
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-600 px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-lg shadow-emerald-950/40 hover:bg-emerald-500 transition-colors"
          >
            <UserPlus className="size-4" />
            <span>Thêm Người Dùng Mới</span>
          </button>
        </div>
      </div>

      {/* Page-level Alerts */}
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-500/50 bg-red-950/60 px-4 py-3 text-sm text-red-200 shadow-md">
          <div className="flex items-center gap-3">
            <AlertCircle className="size-5 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-white">
            <X className="size-4" />
          </button>
        </div>
      )}
      {successMsg && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/50 bg-emerald-950/60 px-4 py-3 text-sm text-emerald-200 shadow-md">
          <div className="flex items-center gap-3">
            <Check className="size-5 shrink-0 text-emerald-400" />
            <span>{successMsg}</span>
          </div>
          <button type="button" onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-white">
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* Users Table */}
      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md shadow-xl">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-950/80 text-xs uppercase tracking-wider text-slate-300 font-semibold">
            <tr>
              <th className="px-5 py-4">Số Điện Thoại</th>
              <th className="px-5 py-4">Vai Trò</th>
              <th className="px-5 py-4">Trạng Thái</th>
              <th className="px-5 py-4">Mã PIN</th>
              <th className="px-5 py-4">Ngày Tạo</th>
              <th className="px-5 py-4 text-right">Thao Tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-slate-200">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-slate-400">
                  Đang tải danh sách người dùng…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-slate-400">
                  Chưa có tài khoản nào trong hệ thống.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-5 py-4 font-bold text-white text-base">{formatPhoneNumber(u.phoneNumber)}</td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-bold ${
                        u.role === 'ADMIN'
                          ? 'border border-purple-500/40 bg-purple-950/50 text-purple-300'
                          : u.role === 'OPERATOR'
                          ? 'border border-emerald-500/40 bg-emerald-950/50 text-emerald-300'
                          : 'border border-blue-500/40 bg-blue-950/50 text-blue-300'
                      }`}
                    >
                      {u.role === 'OPERATOR'
                        ? 'Nông dân (OPERATOR)'
                        : u.role === 'AUDITOR'
                        ? 'Giám sát (AUDITOR)'
                        : 'Quản trị viên (ADMIN)'}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                        u.isActive
                          ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/40'
                          : 'bg-red-950/80 text-red-400 border border-red-500/40'
                      }`}
                    >
                      <span className={`size-2 rounded-full ${u.isActive ? 'bg-emerald-400' : 'bg-red-400'}`} />
                      {u.isActive ? 'Hoạt động' : 'Bị khóa'}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-slate-300 text-xs">
                    {u.mustSetPin ? (
                      <span className="font-semibold text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-500/30">
                        Phải đổi PIN lần đầu
                      </span>
                    ) : (
                      <span className="text-slate-400">Đã thiết lập</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-slate-400 text-xs">
                    {new Date(u.createdAt).toLocaleDateString('vi-VN')}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEditModal(u)}
                        className="flex min-h-[40px] min-w-[40px] cursor-pointer items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-slate-200 hover:border-slate-500 hover:bg-slate-700 hover:text-white transition-colors"
                        title="Chỉnh sửa tài khoản"
                      >
                        <Edit3 className="size-4" />
                        <span className="sr-only sm:not-sr-only sm:ml-1 text-xs">Sửa</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openResetPinModal(u)}
                        className="flex min-h-[40px] min-w-[40px] cursor-pointer items-center justify-center rounded-xl border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-amber-300 hover:bg-amber-900/60 transition-colors"
                        title="Đặt lại mã PIN"
                      >
                        <Key className="size-4" />
                        <span className="sr-only sm:not-sr-only sm:ml-1 text-xs">Reset PIN</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openAccessModal(u)}
                        className="flex min-h-[40px] min-w-[40px] cursor-pointer items-center justify-center rounded-xl border border-blue-500/40 bg-blue-950/40 px-3 py-2 text-blue-300 hover:bg-blue-900/60 transition-colors"
                        title="Phân quyền Nhà Nấm"
                      >
                        <Home className="size-4" />
                        <span className="sr-only sm:not-sr-only sm:ml-1 text-xs">Nhà nấm</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal: Tạo User */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base sm:text-lg font-bold text-white">Thêm Tài Khoản Người Dùng Mới</h3>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-lg p-1.5 cursor-pointer text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Modal Internal Error Alert */}
            {modalError && (
              <div className="flex items-start gap-3 rounded-xl border border-red-500/60 bg-red-950/80 p-3.5 text-xs sm:text-sm text-red-200 shadow-md">
                <AlertCircle className="size-5 shrink-0 text-red-400 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-red-300">Lỗi khi tạo tài khoản:</p>
                  <p className="leading-relaxed text-red-100">{modalError}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-200 mb-1.5">
                  Số điện thoại người dùng (VN)
                </label>
                <input
                  type="tel"
                  required
                  placeholder="Ví dụ: 0901234567"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-200 mb-1.5">
                  Mã PIN ban đầu (6 chữ số)
                </label>
                <div className="relative">
                  <input
                    type={showNewPin ? 'text' : 'password'}
                    required
                    maxLength={6}
                    pattern="^[0-9]{6}$"
                    placeholder="Nhập 6 chữ số"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 pr-11 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none tracking-widest"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPin(!showNewPin)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
                    title={showNewPin ? 'Ẩn PIN' : 'Hiện PIN'}
                  >
                    {showNewPin ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <div className="mt-2 rounded-lg bg-amber-950/40 border border-amber-500/30 p-2.5 text-xs text-amber-200 space-y-1">
                  <p className="font-semibold text-amber-300">Quy tắc mã PIN an toàn:</p>
                  <p>• Mã PIN bắt buộc phải gồm đúng 6 chữ số (0-9).</p>
                  <p>• Không dùng số lặp (ví dụ: 111111) hoặc dãy liên tiếp (123456, 654321).</p>
                </div>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-200 mb-1.5">
                  Vai trò hệ thống
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as 'ADMIN' | 'OPERATOR' | 'AUDITOR')}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                >
                  <option value="OPERATOR">OPERATOR — Nông dân / Người vận hành nhà nấm</option>
                  <option value="AUDITOR">AUDITOR — Giám sát / Kiểm toán viên (chỉ xem)</option>
                  <option value="ADMIN">ADMIN — Quản trị viên hệ thống (toàn quyền)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 transition-colors disabled:opacity-50 shadow-md"
                >
                  {submitting ? 'Đang khởi tạo…' : 'Tạo Tài Khoản'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit User */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base sm:text-lg font-bold text-white">Chỉnh Sửa Tài Khoản: {formatPhoneNumber(editUser.phoneNumber)}</h3>
              <button
                type="button"
                onClick={() => setEditUser(null)}
                className="rounded-lg p-1.5 cursor-pointer text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Modal Internal Error Alert */}
            {modalError && (
              <div className="flex items-start gap-3 rounded-xl border border-red-500/60 bg-red-950/80 p-3.5 text-xs sm:text-sm text-red-200 shadow-md">
                <AlertCircle className="size-5 shrink-0 text-red-400 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-red-300">Lỗi khi cập nhật tài khoản:</p>
                  <p className="leading-relaxed text-red-100">{modalError}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleUpdateUser} className="space-y-4">
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-200 mb-1.5">Vai trò hệ thống</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as 'ADMIN' | 'OPERATOR' | 'AUDITOR')}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                >
                  <option value="OPERATOR">OPERATOR — Nông dân / Người vận hành nhà nấm</option>
                  <option value="AUDITOR">AUDITOR — Giám sát / Kiểm toán viên (chỉ xem)</option>
                  <option value="ADMIN">ADMIN — Quản trị viên hệ thống (toàn quyền)</option>
                </select>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 p-3.5">
                <div>
                  <p className="text-sm font-semibold text-white">Trạng thái hoạt động</p>
                  <p className="text-xs text-slate-400">Khóa tài khoản nếu người dùng nghỉ việc hoặc tạm dừng</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditActive(!editActive)}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                    editActive ? 'bg-emerald-600' : 'bg-slate-800'
                  }`}
                >
                  <span
                    className={`inline-block size-5 transform rounded-full bg-white transition-transform ${
                      editActive ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-200 mb-1.5">
                  Đặt mã PIN mới (Tùy chọn)
                </label>
                <div className="relative">
                  <input
                    type={showEditPin ? 'text' : 'password'}
                    maxLength={6}
                    placeholder="Để trống nếu không muốn thay đổi mã PIN"
                    value={editPin}
                    onChange={(e) => setEditPin(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 pr-11 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none tracking-widest"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEditPin(!showEditPin)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
                    title={showEditPin ? 'Ẩn PIN' : 'Hiện PIN'}
                  >
                    {showEditPin ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditUser(null)}
                  className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 transition-colors disabled:opacity-50 shadow-md"
                >
                  {submitting ? 'Đang lưu…' : 'Cập Nhật Tài Khoản'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Reset PIN */}
      {resetPinUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base sm:text-lg font-bold text-white">Reset Mã PIN: {formatPhoneNumber(resetPinUser.phoneNumber)}</h3>
              <button
                type="button"
                onClick={() => setResetPinUser(null)}
                className="rounded-lg p-1.5 cursor-pointer text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Modal Internal Error Alert */}
            {modalError && (
              <div className="flex items-start gap-3 rounded-xl border border-red-500/60 bg-red-950/80 p-3.5 text-xs sm:text-sm text-red-200 shadow-md">
                <AlertCircle className="size-5 shrink-0 text-red-400 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-red-300">Lỗi khi đặt lại mã PIN:</p>
                  <p className="leading-relaxed text-red-100">{modalError}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleResetPin} className="space-y-4">
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-200 mb-1.5">
                  Mã PIN 6 chữ số mới
                </label>
                <div className="relative">
                  <input
                    type={showResetPin ? 'text' : 'password'}
                    required
                    maxLength={6}
                    pattern="^[0-9]{6}$"
                    placeholder="Nhập 6 chữ số mới"
                    value={resetPinValue}
                    onChange={(e) => setResetPinValue(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 pr-11 text-sm text-white placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 focus:outline-none tracking-widest"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPin(!showResetPin)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
                    title={showResetPin ? 'Ẩn PIN' : 'Hiện PIN'}
                  >
                    {showResetPin ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <div className="mt-2 rounded-lg bg-amber-950/40 border border-amber-500/30 p-2.5 text-xs text-amber-200 space-y-1">
                  <p className="font-semibold text-amber-300">Yêu cầu mã PIN mới:</p>
                  <p>• Phải đúng 6 chữ số, không dùng dãy số đơn giản như 123456 hoặc 111111.</p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setResetPinUser(null)}
                  className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-amber-500/40 bg-amber-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-amber-500 transition-colors disabled:opacity-50 shadow-md"
                >
                  {submitting ? 'Đang thực hiện…' : 'Đặt Lại PIN'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: House Access */}
      {accessUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base sm:text-lg font-bold text-white">Phân Quyền Nhà Nấm: {formatPhoneNumber(accessUser.phoneNumber)}</h3>
              <button
                type="button"
                onClick={() => setAccessUser(null)}
                className="rounded-lg p-1.5 cursor-pointer text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Modal Internal Error Alert */}
            {modalError && (
              <div className="flex items-start gap-3 rounded-xl border border-red-500/60 bg-red-950/80 p-3.5 text-xs sm:text-sm text-red-200 shadow-md">
                <AlertCircle className="size-5 shrink-0 text-red-400 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-red-300">Lỗi khi phân quyền:</p>
                  <p className="leading-relaxed text-red-100">{modalError}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleSaveHouseAccess} className="space-y-4">
              <p className="text-sm text-slate-300">
                Tích chọn các Nhà nấm mà tài khoản này có quyền theo dõi và vận hành:
              </p>
              
              <div className="max-h-64 overflow-y-auto space-y-2.5 rounded-xl border border-slate-800 bg-slate-950 p-3">
                {houses.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-6">Chưa có nhà nấm nào trong hệ thống.</p>
                ) : (
                  houses.map((h) => {
                    const checked = selectedHouseIds.includes(h.id)
                    return (
                      <label
                        key={h.id}
                        className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                          checked
                            ? 'border-emerald-500/50 bg-emerald-950/30'
                            : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedHouseIds([...selectedHouseIds, h.id])
                            } else {
                              setSelectedHouseIds(selectedHouseIds.filter((id) => id !== h.id))
                            }
                          }}
                          className="size-5 rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 bg-slate-950"
                        />
                        <div>
                          <p className="text-sm font-bold text-white">{h.name}</p>
                          <p className="text-xs text-slate-400">Mã nhà: {h.id} {h.areaMeters ? `• Diện tích: ${h.areaMeters}` : ''}</p>
                        </div>
                      </label>
                    )
                  })
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setAccessUser(null)}
                  className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-blue-500/40 bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-500 transition-colors disabled:opacity-50 shadow-md"
                >
                  {submitting ? 'Đang lưu…' : 'Lưu Phân Quyền'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
