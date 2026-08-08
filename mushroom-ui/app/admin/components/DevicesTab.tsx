'use client'

import React, { useEffect, useState } from 'react'
import { adminApi, type AdminDevice, type AdminHouse, type AdminUser } from '@/lib/admin-api'
import { Cpu, Plus, Edit3, Key, RefreshCw, AlertCircle, Check, X, Copy, ShieldAlert } from 'lucide-react'

export function DevicesTab() {
  const [devices, setDevices] = useState<AdminDevice[]>([])
  const [houses, setHouses] = useState<AdminHouse[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

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

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [dRes, hRes, uRes] = await Promise.all([
        adminApi.listDevices(),
        adminApi.listHouses(),
        adminApi.listUsers(),
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
      setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu thiết bị.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleCreateDevice = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
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
      setError(err instanceof Error ? err.message : 'Lỗi khi đăng ký thiết bị.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdateDevice = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editDevice) return
    setSubmitting(true)
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
      setError(err instanceof Error ? err.message : 'Lỗi khi cập nhật thiết bị.')
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

  const openEdit = (d: AdminDevice) => {
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
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-mono text-lg font-bold text-white">Quản Lý Thiết Bị IoT (Device Provisioning)</h2>
          <p className="text-xs text-slate-400">Đăng ký, gán nhà nấm, cấu hình MQTT PSK Token và kiểm soát kết nối ESP32</p>
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
            <Plus className="size-4" />
            <span>Đăng Ký Thiết Bị</span>
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

      {/* Devices Table */}
      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/50 backdrop-blur-md shadow-xl">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-800 bg-slate-950/80 font-mono text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-3.5">Device ID (MAC)</th>
              <th className="px-4 py-3.5">Tên Hiển Thị</th>
              <th className="px-4 py-3.5">Nhà Nấm Gán</th>
              <th className="px-4 py-3.5">Chủ Sở Hữu</th>
              <th className="px-4 py-3.5">Trạng Thái Kết Nối</th>
              <th className="px-4 py-3.5">Khóa Thiết Bị</th>
              <th className="px-4 py-3.5">Lần Cuối Thấy</th>
              <th className="px-4 py-3.5 text-right">Thao Tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono text-slate-200">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                  Đang tải danh sách thiết bị…
                </td>
              </tr>
            ) : devices.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                  Chưa có thiết bị nào được đăng ký.
                </td>
              </tr>
            ) : (
              devices.map((d) => (
                <tr key={d.deviceId} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3.5 font-bold text-emerald-400 font-mono">{d.deviceId}</td>
                  <td className="px-4 py-3.5 text-white">{d.displayName || '—'}</td>
                  <td className="px-4 py-3.5">
                    <span className="inline-flex rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-300">
                      {d.houseName}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-slate-300">{d.ownerPhone}</td>
                  <td className="px-4 py-3.5">
                    {d.onlineStatus === 'online' ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-950/40 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400">
                        <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        ONLINE
                      </span>
                    ) : d.onlineStatus === 'offline' ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-950/40 px-2.5 py-0.5 text-[10px] font-bold text-red-400">
                        <span className="size-1.5 rounded-full bg-red-400" />
                        OFFLINE
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-950/40 px-2.5 py-0.5 text-[10px] font-bold text-amber-400">
                        <span className="size-1.5 rounded-full bg-amber-400" />
                        CHƯA KẾT NỐI
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold ${
                        d.enabled
                          ? 'border border-emerald-500/30 bg-emerald-950/30 text-emerald-300'
                          : 'border border-red-500/30 bg-red-950/30 text-red-400'
                      }`}
                    >
                      {d.enabled ? 'Cho phép' : 'Đã khóa'}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-slate-400 text-[11px]">
                    {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString('vi-VN') : 'Chưa có'}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEdit(d)}
                        className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-slate-300 hover:border-slate-500 hover:text-white transition-colors"
                        title="Chỉnh sửa / Reassign thiết bị"
                      >
                        <Edit3 className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRegenerateToken(d.deviceId)}
                        className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-amber-500/30 bg-amber-950/30 px-2.5 py-1.5 text-amber-300 hover:bg-amber-900/50 transition-colors"
                        title="Cấp lại MQTT Token/PSK"
                      >
                        <Key className="size-3.5" />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-mono text-sm font-bold text-white flex items-center gap-2">
                <Cpu className="size-4 text-emerald-400" />
                Đăng Ký Thiết Bị IoT Mới
              </h3>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-lg p-1 cursor-pointer text-slate-400 hover:bg-slate-900 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleCreateDevice} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Device ID (trùng MAC Address)</label>
                <input
                  type="text"
                  required
                  pattern="^[a-zA-Z0-9_-]{3,50}$"
                  placeholder="VD: mushroom_s3_a4cf128b9e02"
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
                />
                <p className="mt-1 text-[10px] text-slate-500">Mã cố định nạp trong chip ESP32 hoặc quét từ mã QR.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Tên Hiển Thị (Tùy chọn)</label>
                <input
                  type="text"
                  placeholder="VD: Bộ điều khiển Nhà B1"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Gán Vào Nhà Nấm</label>
                <select
                  value={houseId}
                  onChange={(e) => setHouseId(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                >
                  {houses.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} ({h.id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Gán Cho Người Vận Hành (Owner)</label>
                <select
                  value={ownerUserId}
                  onChange={(e) => setOwnerUserId(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.phoneNumber} ({u.role})
                    </option>
                  ))}
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
                  {submitting ? 'Đang tạo…' : 'Đăng Ký & Tạo Token'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Device */}
      {editDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-mono text-sm font-bold text-white">Chỉnh Sửa Thiết Bị: {editDevice.deviceId}</h3>
              <button
                type="button"
                onClick={() => setEditDevice(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-900 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateDevice} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Tên Hiển Thị</label>
                <input
                  type="text"
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Chuyển Sang Nhà Nấm Khác</label>
                <select
                  value={editHouseId}
                  onChange={(e) => setEditHouseId(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                >
                  {houses.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} ({h.id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Chuyển Chủ Sở Hữu</label>
                <select
                  value={editOwnerUserId}
                  onChange={(e) => setEditOwnerUserId(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.phoneNumber} ({u.role})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3">
                <label className="text-xs font-semibold text-slate-300">Cho phép hoạt động:</label>
                <button
                  type="button"
                  onClick={() => setEditEnabled(!editEnabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    editEnabled ? 'bg-emerald-600' : 'bg-slate-800'
                  }`}
                >
                  <span
                    className={`inline-block size-4 transform rounded-full bg-white transition-transform ${
                      editEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className="text-xs font-mono text-slate-400">
                  {editEnabled ? 'Bật (Enabled)' : 'Khóa (Ngắt MQTT)'}
                </span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditDevice(null)}
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

      {/* Modal: One-Time Token Output */}
      {tokenModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4">
          <div className="w-full max-w-lg rounded-2xl border border-emerald-500/50 bg-slate-950 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 text-emerald-400">
              <h3 className="font-mono text-sm font-bold flex items-center gap-2">
                <Key className="size-4" />
                Mã MQTT Token / PSK Của Thiết Bị
              </h3>
              <button
                type="button"
                onClick={() => setTokenModalData(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-900 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            <div>
              <p className="text-xs text-slate-300 mb-1">
                Mã thiết bị: <strong className="text-white font-mono">{tokenModalData.deviceId}</strong>
              </p>
              <div className="relative mt-2">
                <textarea
                  readOnly
                  rows={3}
                  value={tokenModalData.rawToken}
                  className="w-full rounded-xl border border-emerald-500/40 bg-slate-900 p-3 font-mono text-xs text-emerald-300 focus:outline-none select-all resize-none"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(tokenModalData.rawToken)}
                  className="absolute right-2 top-2 flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/80 px-2.5 py-1 text-[11px] font-bold text-emerald-300 hover:bg-emerald-900 transition-colors"
                >
                  {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                  <span>{copied ? 'Đã Sao Chép!' : 'Sao Chép'}</span>
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-red-500/40 bg-red-950/40 p-3.5 text-xs text-red-200 space-y-1">
              <div className="flex items-center gap-2 font-bold text-red-400 uppercase tracking-wide">
                <ShieldAlert className="size-4" />
                Cảnh báo an toàn phần cứng (One-Time Token)
              </div>
              <p className="text-[11px] text-red-200/90 leading-relaxed">
                Mã Token/PSK này <strong>chỉ hiển thị DUY NHẤT một lần này</strong>. Hãy sao chép và nạp vào Flash NVS hoặc Firmware ESP32 ngay lập tức. Sau khi đóng cửa sổ này, bạn sẽ không thể xem lại Token!
              </p>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setTokenModalData(null)}
                className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-600 px-6 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition-colors"
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
