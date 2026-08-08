'use client'

import React, { useEffect, useState } from 'react'
import { adminApi, type AdminUser, type AdminHouse } from '@/lib/admin-api'
import { UserPlus, Edit3, Key, Home, RefreshCw, AlertCircle, Check, X } from 'lucide-react'

export function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [houses, setHouses] = useState<AdminHouse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Dialog states
  const [createOpen, setCreateOpen] = useState(false)
  const [editUser, setEditUser] = useState<AdminUser | null>(null)
  const [resetPinUser, setResetPinUser] = useState<AdminUser | null>(null)
  const [accessUser, setAccessUser] = useState<AdminUser | null>(null)

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

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [uData, hData] = await Promise.all([
        adminApi.listUsers(),
        adminApi.listHouses(),
      ])
      setUsers(uData)
      setHouses(hData.data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách người dùng.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccessMsg(null)
    try {
      await adminApi.createUser({
        phoneNumber: newPhone,
        pin: newPin,
        role: newRole,
      })
      setSuccessMsg(`Tạo tài khoản ${newPhone} thành công!`)
      setCreateOpen(false)
      setNewPhone('')
      setNewPin('')
      fetchData()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lỗi khi tạo người dùng.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editUser) return
    setSubmitting(true)
    setError(null)
    setSuccessMsg(null)
    try {
      await adminApi.updateUser(editUser.id, {
        role: editRole,
        isActive: editActive,
        newPin: editPin || undefined,
      })
      setSuccessMsg(`Cập nhật người dùng ${editUser.phoneNumber} thành công!`)
      setEditUser(null)
      fetchData()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lỗi khi cập nhật người dùng.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleResetPin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resetPinUser) return
    setSubmitting(true)
    setError(null)
    setSuccessMsg(null)
    try {
      await adminApi.resetPin(resetPinUser.id, resetPinValue)
      setSuccessMsg(`Đã đặt lại PIN cho ${resetPinUser.phoneNumber}!`)
      setResetPinUser(null)
      setResetPinValue('')
      fetchData()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lỗi khi đặt lại PIN.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSaveHouseAccess = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!accessUser) return
    setSubmitting(true)
    setError(null)
    setSuccessMsg(null)
    try {
      await adminApi.setHouseAccess(accessUser.id, selectedHouseIds)
      setSuccessMsg(`Cập nhật quyền truy cập nhà nấm cho ${accessUser.phoneNumber} thành công!`)
      setAccessUser(null)
      fetchData()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lỗi khi phân quyền nhà nấm.')
    } finally {
      setSubmitting(false)
    }
  }

  const openEditModal = (u: AdminUser) => {
    setEditUser(u)
    setEditRole(u.role)
    setEditActive(u.isActive)
    setEditPin('')
  }

  const openAccessModal = (u: AdminUser) => {
    setAccessUser(u)
    // House IDs accessible will be handled or checked
    setSelectedHouseIds([])
  }

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-mono text-lg font-bold text-white">Quản Lý Tài Khoản Người Dùng</h2>
          <p className="text-xs text-slate-400">Danh sách tài khoản Admin, Operator & Auditor</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchData()}
            className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className="size-4" />
            <span>Làm mới</span>
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-950/40 hover:bg-emerald-500 transition-colors"
          >
            <UserPlus className="size-4" />
            <span>Thêm Người Dùng</span>
          </button>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-xs text-red-200">
          <AlertCircle className="size-5 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-4 py-3 text-xs text-emerald-200">
          <Check className="size-5 shrink-0 text-emerald-400" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Users Table */}
      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/50 backdrop-blur-md shadow-xl">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-800 bg-slate-950/80 font-mono text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-3.5">Số Điện Thoại</th>
              <th className="px-4 py-3.5">Vai Trò</th>
              <th className="px-4 py-3.5">Trạng Thái</th>
              <th className="px-4 py-3.5">Đổi PIN</th>
              <th className="px-4 py-3.5">Ngày Tạo</th>
              <th className="px-4 py-3.5 text-right">Thao Tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono text-slate-200">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Đang tải danh sách người dùng…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Chưa có tài khoản nào.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3.5 font-bold text-white">{u.phoneNumber}</td>
                  <td className="px-4 py-3.5">
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold ${
                        u.role === 'ADMIN'
                          ? 'border border-purple-500/40 bg-purple-950/40 text-purple-300'
                          : u.role === 'OPERATOR'
                          ? 'border border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                          : 'border border-blue-500/40 bg-blue-950/40 text-blue-300'
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        u.isActive
                          ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                          : 'bg-red-950/60 text-red-400 border border-red-500/30'
                      }`}
                    >
                      <span className={`size-1.5 rounded-full ${u.isActive ? 'bg-emerald-400' : 'bg-red-400'}`} />
                      {u.isActive ? 'Hoạt động' : 'Bị khóa'}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-slate-400">
                    {u.mustSetPin ? (
                      <span className="text-amber-400">Bắt buộc</span>
                    ) : (
                      <span className="text-slate-500">Đã thiết lập</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-slate-400">
                    {new Date(u.createdAt).toLocaleDateString('vi-VN')}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEditModal(u)}
                        className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-slate-300 hover:border-slate-500 hover:text-white transition-colors"
                        title="Chỉnh sửa tài khoản"
                      >
                        <Edit3 className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setResetPinUser(u)
                          setResetPinValue('')
                        }}
                        className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-amber-500/30 bg-amber-950/30 px-2.5 py-1.5 text-amber-300 hover:bg-amber-900/50 transition-colors"
                        title="Reset PIN"
                      >
                        <Key className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openAccessModal(u)}
                        className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-blue-500/30 bg-blue-950/30 px-2.5 py-1.5 text-blue-300 hover:bg-blue-900/50 transition-colors"
                        title="Phân quyền Nhà Nấm"
                      >
                        <Home className="size-3.5" />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-mono text-sm font-bold text-white">Thêm Tài Khoản Người Dùng Mới</h3>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-lg p-1 cursor-pointer text-slate-400 hover:bg-slate-900 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Số điện thoại (VN)</label>
                <input
                  type="text"
                  required
                  placeholder="0901234567 hoặc +84901234567"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Mã PIN ban đầu (6 chữ số)</label>
                <input
                  type="password"
                  required
                  maxLength={6}
                  pattern="^[0-9]{6}$"
                  placeholder="123456"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
                />
                <p className="mt-1 text-[10px] text-slate-500">Người dùng sẽ phải đổi PIN ở lần đăng nhập đầu tiên.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Vai trò hệ thống</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as 'ADMIN' | 'OPERATOR' | 'AUDITOR')}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="OPERATOR">OPERATOR (Nông dân / Người vận hành)</option>
                  <option value="AUDITOR">AUDITOR (Kiểm toán viên / Giám sát)</option>
                  <option value="ADMIN">ADMIN (Quản trị viên hệ thống)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-slate-800 px-4 py-2 text-xs font-semibold text-slate-400 hover:bg-slate-900"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Đang tạo…' : 'Tạo Tài Khoản'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit User */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-mono text-sm font-bold text-white">Chỉnh Sửa: {editUser.phoneNumber}</h3>
              <button
                type="button"
                onClick={() => setEditUser(null)}
                className="rounded-lg p-1 cursor-pointer text-slate-400 hover:bg-slate-900 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Vai trò</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as 'ADMIN' | 'OPERATOR' | 'AUDITOR')}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="OPERATOR">OPERATOR</option>
                  <option value="AUDITOR">AUDITOR</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>

              <div className="flex items-center gap-3">
                <label className="text-xs font-semibold text-slate-300">Trạng thái tài khoản:</label>
                <button
                  type="button"
                  onClick={() => setEditActive(!editActive)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    editActive ? 'bg-emerald-600' : 'bg-slate-800'
                  }`}
                >
                  <span
                    className={`inline-block size-4 transform rounded-full bg-white transition-transform ${
                      editActive ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className="text-xs font-mono text-slate-400">
                  {editActive ? 'Hoạt động' : 'Bị khóa'}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Đặt lại PIN mới (tùy chọn)</label>
                <input
                  type="password"
                  maxLength={6}
                  placeholder="Để trống nếu không đổi PIN"
                  value={editPin}
                  onChange={(e) => setEditPin(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditUser(null)}
                  className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-slate-800 px-4 py-2 text-xs font-semibold text-slate-400 hover:bg-slate-900"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Đang lưu…' : 'Cập Nhật'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Reset PIN */}
      {resetPinUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-mono text-sm font-bold text-white">Reset PIN: {resetPinUser.phoneNumber}</h3>
              <button
                type="button"
                onClick={() => setResetPinUser(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-900 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleResetPin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Mã PIN 6 chữ số mới</label>
                <input
                  type="password"
                  required
                  maxLength={6}
                  pattern="^[0-9]{6}$"
                  placeholder="6 chữ số"
                  value={resetPinValue}
                  onChange={(e) => setResetPinValue(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white placeholder-slate-600 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetPinUser(null)}
                  className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-slate-800 px-4 py-2 text-xs font-semibold text-slate-400 hover:bg-slate-900"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-amber-500/40 bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-500 transition-colors disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-mono text-sm font-bold text-white">Phân Quyền Nhà Nấm: {accessUser.phoneNumber}</h3>
              <button
                type="button"
                onClick={() => setAccessUser(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-900 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleSaveHouseAccess} className="space-y-4">
              <p className="text-xs text-slate-400">Chọn các Nhà nấm mà người dùng này được phép quản lý & giám sát:</p>
              
              <div className="max-h-60 overflow-y-auto space-y-2 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                {houses.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-4">Chưa có nhà nấm nào trong hệ thống.</p>
                ) : (
                  houses.map((h) => {
                    const checked = selectedHouseIds.includes(h.id)
                    return (
                      <label
                        key={h.id}
                        className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 cursor-pointer hover:border-slate-700 transition-colors"
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
                          className="size-4 rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 bg-slate-950"
                        />
                        <div>
                          <p className="text-xs font-bold text-white font-mono">{h.name}</p>
                          <p className="text-[10px] text-slate-400 font-mono">ID: {h.id}</p>
                        </div>
                      </label>
                    )
                  })
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAccessUser(null)}
                  className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-slate-800 px-4 py-2 text-xs font-semibold text-slate-400 hover:bg-slate-900"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-blue-500/40 bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
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
