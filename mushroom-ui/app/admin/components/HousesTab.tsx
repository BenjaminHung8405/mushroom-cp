'use client'

import React, { useEffect, useState } from 'react'
import { adminApi, type AdminHouse } from '@/lib/admin-api'
import { Plus, Edit3, Trash2, RefreshCw, AlertCircle, Check, X, Home } from 'lucide-react'

export function HousesTab() {
  const [houses, setHouses] = useState<AdminHouse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Modals
  const [createOpen, setCreateOpen] = useState(false)
  const [editHouse, setEditHouse] = useState<AdminHouse | null>(null)
  const [deleteHouse, setDeleteHouse] = useState<AdminHouse | null>(null)

  // Form states
  const [houseId, setHouseId] = useState('')
  const [houseName, setHouseName] = useState('')
  const [areaMeters, setAreaMeters] = useState('4x6')
  const [pillarCount, setPillarCount] = useState(35)

  const [editName, setEditName] = useState('')
  const [editArea, setEditArea] = useState('4x6')
  const [editPillars, setEditPillars] = useState(35)

  const [submitting, setSubmitting] = useState(false)

  const fetchHouses = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await adminApi.listHouses()
      setHouses(res.data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách nhà nấm.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHouses()
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccessMsg(null)
    try {
      await adminApi.createHouse({
        id: houseId,
        name: houseName,
        areaMeters,
        pillarCount: Number(pillarCount),
      })
      setSuccessMsg(`Tạo nhà nấm ${houseName} (${houseId}) thành công!`)
      setCreateOpen(false)
      setHouseId('')
      setHouseName('')
      setAreaMeters('4x6')
      setPillarCount(35)
      fetchHouses()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lỗi khi tạo nhà nấm.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editHouse) return
    setSubmitting(true)
    setError(null)
    setSuccessMsg(null)
    try {
      await adminApi.updateHouse(editHouse.id, {
        name: editName,
        areaMeters: editArea,
        pillarCount: Number(editPillars),
      })
      setSuccessMsg(`Cập nhật nhà nấm ${editHouse.id} thành công!`)
      setEditHouse(null)
      fetchHouses()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lỗi khi cập nhật nhà nấm.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteHouse) return
    setSubmitting(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const res = await adminApi.deleteHouse(deleteHouse.id)
      setSuccessMsg(res.message)
      setDeleteHouse(null)
      fetchHouses()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không thể xóa nhà nấm.')
    } finally {
      setSubmitting(false)
    }
  }

  const openEdit = (h: AdminHouse) => {
    setEditHouse(h)
    setEditName(h.name)
    setEditArea(h.areaMeters)
    setEditPillars(h.pillarCount)
  }

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-mono text-lg font-bold text-white">Quản Lý Nhà Nấm (Mushroom Houses)</h2>
          <p className="text-xs text-slate-400">Danh sách các phòng/nhà nấm rơm và cấu hình diện tích</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchHouses()}
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
            <span>Tạo Nhà Nấm Mới</span>
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

      {/* Houses Table */}
      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/50 backdrop-blur-md shadow-xl">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-800 bg-slate-950/80 font-mono text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-3.5">Mã Slug (ID)</th>
              <th className="px-4 py-3.5">Tên Nhà Nấm</th>
              <th className="px-4 py-3.5">Diện Tích</th>
              <th className="px-4 py-3.5">Số Trụ Nấm</th>
              <th className="px-4 py-3.5">Số Thiết Bị</th>
              <th className="px-4 py-3.5">Người Giám Sát</th>
              <th className="px-4 py-3.5 text-right">Thao Tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono text-slate-200">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  Đang tải danh sách nhà nấm…
                </td>
              </tr>
            ) : houses.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  Chưa có nhà nấm nào được đăng ký.
                </td>
              </tr>
            ) : (
              houses.map((h) => (
                <tr key={h.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3.5 font-bold text-emerald-400">{h.id}</td>
                  <td className="px-4 py-3.5 text-white font-semibold">{h.name}</td>
                  <td className="px-4 py-3.5 text-slate-300">{h.areaMeters} m</td>
                  <td className="px-4 py-3.5 text-slate-300">{h.pillarCount} trụ</td>
                  <td className="px-4 py-3.5">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        h.deviceCount > 0
                          ? 'border border-emerald-500/30 bg-emerald-950/40 text-emerald-300'
                          : 'border border-slate-700 bg-slate-800 text-slate-400'
                      }`}
                    >
                      {h.deviceCount} thiết bị
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-slate-400">{h.activeUserCount} người</td>
                  <td className="px-4 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEdit(h)}
                        className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-slate-300 hover:border-slate-500 hover:text-white transition-colors"
                        title="Chỉnh sửa nhà nấm"
                      >
                        <Edit3 className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteHouse(h)}
                        className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-red-500/30 bg-red-950/30 px-2.5 py-1.5 text-red-300 hover:bg-red-900/50 transition-colors"
                        title="Xóa nhà nấm"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal: Tạo House */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-mono text-sm font-bold text-white flex items-center gap-2">
                <Home className="size-4 text-emerald-400" />
                Tạo Nhà Nấm Mới
              </h3>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-lg p-1 cursor-pointer text-slate-400 hover:bg-slate-900 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Mã Slug ID (MQTT Topic safe)</label>
                <input
                  type="text"
                  required
                  pattern="^[a-z0-9_-]{3,50}$"
                  placeholder="VD: house_b1, khu_a_phong_2"
                  value={houseId}
                  onChange={(e) => setHouseId(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
                />
                <p className="mt-1 text-[10px] text-slate-500">
                  Chỉ gồm chữ thường, số, gạch dưới (_) và gạch ngang (-). Không dấu, không khoảng trắng.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Tên Nhà Nấm</label>
                <input
                  type="text"
                  required
                  placeholder="VD: Nhà Nấm Trại B1"
                  value={houseName}
                  onChange={(e) => setHouseName(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Diện tích (m²)</label>
                  <input
                    type="text"
                    required
                    placeholder="4x6"
                    value={areaMeters}
                    onChange={(e) => setAreaMeters(e.target.value)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Số trụ nấm</label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={500}
                    value={pillarCount}
                    onChange={(e) => setPillarCount(parseInt(e.target.value, 10))}
                    className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
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
                  {submitting ? 'Đang tạo…' : 'Tạo Nhà Nấm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit House */}
      {editHouse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-mono text-sm font-bold text-white">Chỉnh Sửa Nhà Nấm: {editHouse.id}</h3>
              <button
                type="button"
                onClick={() => setEditHouse(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-900 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleUpdate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Tên Nhà Nấm</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Diện tích (m²)</label>
                  <input
                    type="text"
                    required
                    value={editArea}
                    onChange={(e) => setEditArea(e.target.value)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Số trụ nấm</label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={500}
                    value={editPillars}
                    onChange={(e) => setEditPillars(parseInt(e.target.value, 10))}
                    className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditHouse(null)}
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

      {/* Modal: Delete House Confirmation */}
      {deleteHouse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 text-red-400">
              <h3 className="font-mono text-sm font-bold flex items-center gap-2">
                <AlertCircle className="size-4" />
                Xác Nhận Xóa Nhà Nấm
              </h3>
              <button
                type="button"
                onClick={() => setDeleteHouse(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-900 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Bạn có chắc chắn muốn xóa nhà nấm <strong className="text-white">{deleteHouse.name} ({deleteHouse.id})</strong> không?
            </p>

            {deleteHouse.deviceCount > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 text-xs text-amber-300">
                ⚠️ Nhà nấm này hiện còn <strong>{deleteHouse.deviceCount} thiết bị</strong> gắn vào. Hệ thống sẽ từ chối xóa để đảm bảo toàn vẹn dữ liệu.
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteHouse(null)}
                className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-slate-800 px-4 py-2 text-xs font-semibold text-slate-400 hover:bg-slate-900"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={submitting}
                className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-red-500/40 bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-500 transition-colors disabled:opacity-50"
              >
                {submitting ? 'Đang xóa…' : 'Xóa Nhà Nấm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
