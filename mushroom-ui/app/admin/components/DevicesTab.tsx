'use client'

import React, { useEffect, useState } from 'react'
import { adminApi, type AdminDevice, type AdminHouse, type AdminUser } from '@/lib/admin-api'
import { formatPhoneNumber } from '@/lib/kiosk-storage'
import { Cpu, Plus, Edit3, Key, RefreshCw, AlertCircle, Check, X, Copy, ShieldAlert } from 'lucide-react'

export function DevicesTab() {
  const [devices, setDevices] = useState<AdminDevice[]>([])
  const [houses, setHouses] = useState<AdminHouse[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Modal Error state
  const [modalError, setModalError] = useState<string | null>(null)

  // Modals
  const [createOpen, setCreateOpen] = useState(false)
  const [editDevice, setEditDevice] = useState<AdminDevice | null>(null)

  // One-time Token Modal
  const [tokenModalData, setTokenModalData] = useState<{ deviceId: string; rawToken: string } | null>(null)
  const [copied, setCopied] = useState(false)

  // Form states
  const [deviceId, setDeviceId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [houseId, setHouseId] = useState('')
  const [ownerUserId, setOwnerUserId] = useState('')

  const [editDisplayName, setEditDisplayName] = useState('')
  const [editHouseId, setEditHouseId] = useState('')
  const [editOwnerUserId, setEditOwnerUserId] = useState('')
  const [editEnabled, setEditEnabled] = useState(true)

  const [submitting, setSubmitting] = useState(false)

  const fetchData = async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const [dRes, hRes, uRes] = await Promise.all([
        adminApi.listDevices(signal),
        adminApi.listHouses(signal),
        adminApi.listUsers(signal),
      ])
      setDevices(dRes.data)
      setHouses(hRes.data)
      setUsers(uRes)
      if (hRes.data.length > 0 && !houseId) {
        setHouseId(hRes.data[0].id)
      }
      if (uRes.length > 0 && !ownerUserId) {
        setOwnerUserId(uRes[0].id)
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu thiết bị.')
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
  }

  const handleCreateDevice = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setModalError(null)
    setError(null)
    setSuccessMsg(null)
    try {
      const result = await adminApi.createDevice({
        deviceId,
        displayName: displayName || undefined,
        houseId,
        ownerUserId: ownerUserId || undefined,
      })
      setCreateOpen(false)
      setDeviceId('')
      setDisplayName('')
      fetchData()
      // Open One-time Token Modal
      setTokenModalData({ deviceId: result.deviceId, rawToken: result.rawToken })
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : 'Lỗi khi đăng ký thiết bị.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdateDevice = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editDevice) return
    setSubmitting(true)
    setModalError(null)
    setError(null)
    setSuccessMsg(null)
    try {
      await adminApi.updateDevice(editDevice.deviceId, {
        displayName: editDisplayName || undefined,
        houseId: editHouseId,
        ownerUserId: editOwnerUserId,
        enabled: editEnabled,
      })
      setSuccessMsg(`Cập nhật thiết bị ${editDevice.deviceId} thành công!`)
      setEditDevice(null)
      fetchData()
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : 'Lỗi khi cập nhật thiết bị.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRegenerateToken = async (devId: string) => {
    if (!confirm(`Bạn có chắc muốn cấp lại Token/PSK mới cho thiết bị '${devId}'? Kết nối MQTT cũ sẽ bị ngắt.`)) return
    setSubmitting(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const result = await adminApi.regenerateDeviceToken(devId)
      setTokenModalData({ deviceId: result.deviceId, rawToken: result.rawToken })
      fetchData()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không thể cấp lại Token.')
    } finally {
      setSubmitting(false)
    }
  }

  const openCreate = () => {
    resetModalState()
    setCreateOpen(true)
  }

  const openEdit = (d: AdminDevice) => {
    resetModalState()
    setEditDevice(d)
    setEditDisplayName(d.displayName || '')
    setEditHouseId(d.houseId)
    setEditOwnerUserId(d.ownerUserId)
    setEditEnabled(d.enabled)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6 font-sans">
      {/* Header bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Quản Lý Thiết Bị IoT (ESP32)</h2>
          <p className="text-xs sm:text-sm text-slate-400">Đăng ký thiết bị, phân gán nhà nấm, kiểm soát Token MQTT & trạng thái kết nối</p>
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
            onClick={openCreate}
            className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-600 px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-lg shadow-emerald-950/40 hover:bg-emerald-500 transition-colors"
          >
            <Plus className="size-4" />
            <span>Đăng Ký Thiết Bị Mới</span>
          </button>
        </div>
      </div>

      {/* Page Alerts */}
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

      {/* Devices Table */}
      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md shadow-xl">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-950/80 text-xs uppercase tracking-wider text-slate-300 font-semibold">
            <tr>
              <th className="px-5 py-4">Mã Thiết Bị (Device ID)</th>
              <th className="px-5 py-4">Tên Hiển Thị</th>
              <th className="px-5 py-4">Nhà Nấm</th>
              <th className="px-5 py-4">Chủ Sở Hữu</th>
              <th className="px-5 py-4">Kết Nối</th>
              <th className="px-5 py-4">Trạng Thái</th>
              <th className="px-5 py-4">Lần Cuối Thấy</th>
              <th className="px-5 py-4 text-right">Thao Tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-slate-200">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-slate-400">
                  Đang tải danh sách thiết bị…
                </td>
              </tr>
            ) : devices.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-slate-400">
                  Chưa có thiết bị IoT nào được đăng ký.
                </td>
              </tr>
            ) : (
              devices.map((d) => (
                <tr key={d.deviceId} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-5 py-4 font-bold text-emerald-400 font-mono text-sm">{d.deviceId}</td>
                  <td className="px-5 py-4 text-white font-semibold">{d.displayName || '—'}</td>
                  <td className="px-5 py-4">
                    <span className="inline-flex rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-bold text-slate-200">
                      {d.houseName}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-slate-300">{formatPhoneNumber(d.ownerPhone)}</td>
                  <td className="px-5 py-4">
                    {d.onlineStatus === 'online' ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-950/60 px-3 py-1 text-xs font-bold text-emerald-400">
                        <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                        ONLINE
                      </span>
                    ) : d.onlineStatus === 'offline' ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-950/60 px-3 py-1 text-xs font-bold text-red-400">
                        <span className="size-2 rounded-full bg-red-400" />
                        OFFLINE
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-950/60 px-3 py-1 text-xs font-bold text-amber-400">
                        <span className="size-2 rounded-full bg-amber-400" />
                        CHƯA KẾT NỐI
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-bold ${
                        d.enabled
                          ? 'border border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                          : 'border border-red-500/40 bg-red-950/40 text-red-400'
                      }`}
                    >
                      {d.enabled ? 'Hoạt động' : 'Đã khóa'}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-slate-400 text-xs">
                    {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString('vi-VN') : 'Chưa có'}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(d)}
                        className="flex min-h-[40px] min-w-[40px] cursor-pointer items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-slate-200 hover:border-slate-500 hover:bg-slate-700 hover:text-white transition-colors"
                        title="Chỉnh sửa thiết bị"
                      >
                        <Edit3 className="size-4" />
                        <span className="sr-only sm:not-sr-only sm:ml-1 text-xs">Sửa</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRegenerateToken(d.deviceId)}
                        className="flex min-h-[40px] min-w-[40px] cursor-pointer items-center justify-center rounded-xl border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-amber-300 hover:bg-amber-900/60 transition-colors"
                        title="Cấp lại MQTT Token/PSK"
                      >
                        <Key className="size-4" />
                        <span className="sr-only sm:not-sr-only sm:ml-1 text-xs">Token mới</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal: Đăng Ký Device */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <Cpu className="size-5 text-emerald-400" />
                Đăng Ký Thiết Bị IoT Mới
              </h3>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-lg p-1.5 cursor-pointer text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Modal Error Alert */}
            {modalError && (
              <div className="flex items-start gap-3 rounded-xl border border-red-500/60 bg-red-950/80 p-3.5 text-xs sm:text-sm text-red-200 shadow-md">
                <AlertCircle className="size-5 shrink-0 text-red-400 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-red-300">Lỗi khi đăng ký thiết bị:</p>
                  <p className="leading-relaxed text-red-100">{modalError}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleCreateDevice} className="space-y-4">
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-200 mb-1.5">
                  Mã Thiết Bị / MAC Address (Device ID)
                </label>
                <input
                  type="text"
                  required
                  pattern="^[a-zA-Z0-9_-]{3,50}$"
                  placeholder="Ví dụ: mushroom_s3_a4cf128b9e02"
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-mono"
                />
                <p className="mt-1.5 text-xs text-slate-400">
                  Mã định danh duy nhất của thiết bị nạp sẵn trong phần cứng ESP32.
                </p>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-200 mb-1.5">
                  Tên Hiển Thị (Tùy chọn)
                </label>
                <input
                  type="text"
                  placeholder="Ví dụ: Cảm Biến & Điều Khiển Trại B1"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-200 mb-1.5">Gán Vào Nhà Nấm</label>
                <select
                  value={houseId}
                  onChange={(e) => setHouseId(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                >
                  {houses.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} ({h.id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-200 mb-1.5">
                  Gán Chủ Sở Hữu (Quản lý thiết bị)
                </label>
                <select
                  value={ownerUserId}
                  onChange={(e) => setOwnerUserId(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {formatPhoneNumber(u.phoneNumber)} ({u.role})
                    </option>
                  ))}
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
                  {submitting ? 'Đang khởi tạo…' : 'Đăng Ký & Tạo Token'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Device */}
      {editDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base sm:text-lg font-bold text-white">Chỉnh Sửa Thiết Bị: {editDevice.deviceId}</h3>
              <button
                type="button"
                onClick={() => setEditDevice(null)}
                className="rounded-lg p-1.5 cursor-pointer text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Modal Error Alert */}
            {modalError && (
              <div className="flex items-start gap-3 rounded-xl border border-red-500/60 bg-red-950/80 p-3.5 text-xs sm:text-sm text-red-200 shadow-md">
                <AlertCircle className="size-5 shrink-0 text-red-400 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-red-300">Lỗi khi cập nhật thiết bị:</p>
                  <p className="leading-relaxed text-red-100">{modalError}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleUpdateDevice} className="space-y-4">
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-200 mb-1.5">Tên Hiển Thị</label>
                <input
                  type="text"
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-200 mb-1.5">Chuyển Sang Nhà Nấm Khác</label>
                <select
                  value={editHouseId}
                  onChange={(e) => setEditHouseId(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                >
                  {houses.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} ({h.id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-200 mb-1.5">Chuyển Chủ Sở Hữu</label>
                <select
                  value={editOwnerUserId}
                  onChange={(e) => setEditOwnerUserId(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {formatPhoneNumber(u.phoneNumber)} ({u.role})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 p-3.5">
                <div>
                  <p className="text-sm font-semibold text-white">Cho phép kết nối MQTT</p>
                  <p className="text-xs text-slate-400">Khóa kết nối nếu thiết bị hỏng hoặc thất lạc</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditEnabled(!editEnabled)}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                    editEnabled ? 'bg-emerald-600' : 'bg-slate-800'
                  }`}
                >
                  <span
                    className={`inline-block size-5 transform rounded-full bg-white transition-transform ${
                      editEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditDevice(null)}
                  className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 transition-colors disabled:opacity-50 shadow-md"
                >
                  {submitting ? 'Đang lưu…' : 'Cập Nhật Thiết Bị'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: One-Time Token Output */}
      {tokenModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl border border-emerald-500/50 bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 text-emerald-400">
              <h3 className="text-base sm:text-lg font-bold flex items-center gap-2">
                <Key className="size-5 text-emerald-400" />
                Mã MQTT Token / PSK Của Thiết Bị
              </h3>
              <button
                type="button"
                onClick={() => setTokenModalData(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="size-5" />
              </button>
            </div>

            <div>
              <p className="text-sm text-slate-200 mb-2">
                Mã thiết bị: <strong className="text-white font-mono">{tokenModalData.deviceId}</strong>
              </p>
              <div className="relative mt-2">
                <textarea
                  readOnly
                  rows={3}
                  value={tokenModalData.rawToken}
                  className="w-full rounded-xl border border-emerald-500/40 bg-slate-950 p-3 font-mono text-xs sm:text-sm text-emerald-300 focus:outline-none select-all resize-none"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(tokenModalData.rawToken)}
                  className="absolute right-3 top-3 flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/90 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-900 transition-colors shadow-md"
                >
                  {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
                  <span>{copied ? 'Đã Sao Chép!' : 'Sao Chép'}</span>
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-red-500/50 bg-red-950/60 p-4 text-xs sm:text-sm text-red-200 space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-red-400 uppercase tracking-wide">
                <ShieldAlert className="size-5" />
                Lưu ý quan trọng (One-Time Token)
              </div>
              <p className="text-xs text-red-200 leading-relaxed">
                Mã Token/PSK này <strong>chỉ xuất hiện duy nhất 1 lần</strong>. Hãy bấm sao chép và lưu trữ để nạp vào thiết bị ESP32. Bạn sẽ không thể xem lại Token này sau khi đóng cửa sổ.
              </p>
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setTokenModalData(null)}
                className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 transition-colors shadow-md"
              >
                Tôi Đã Lưu Token (Đóng)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
