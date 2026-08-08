'use client'

import React, { useEffect, useState } from 'react'
import { adminApi, type AdminHouse } from '@/lib/admin-api'
import { Plus, Edit3, Trash2, RefreshCw, AlertCircle, Check, X, Home } from 'lucide-react'

export function HousesTab() {
  const [houses, setHouses] = useState<AdminHouse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Modal Error State
  const [modalError, setModalError] = useState<string | null>(null)

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

  const fetchHouses = async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const res = await adminApi.listHouses(signal)
      setHouses(res.data)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách nhà nấm.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    fetchHouses(controller.signal)
    return () => {
      controller.abort()
    }
  }, [])

  const resetModalState = () => {
    setModalError(null)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setModalError(null)
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
      setModalError(err instanceof Error ? err.message : 'Lỗi khi tạo nhà nấm.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editHouse) return
    setSubmitting(true)
    setModalError(null)
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
      setModalError(err instanceof Error ? err.message : 'Lỗi khi cập nhật nhà nấm.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteHouse) return
    setSubmitting(true)
    setModalError(null)
    setError(null)
    setSuccessMsg(null)
    try {
      const res = await adminApi.deleteHouse(deleteHouse.id)
      setSuccessMsg(res.message)
      setDeleteHouse(null)
      fetchHouses()
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : 'Không thể xóa nhà nấm.')
    } finally {
      setSubmitting(false)
    }
  }

  const openCreate = () => {
    resetModalState()
    setCreateOpen(true)
  }

  const openEdit = (h: AdminHouse) => {
    resetModalState()
    setEditHouse(h)
    setEditName(h.name)
    setEditArea(h.areaMeters)
    setEditPillars(h.pillarCount)
  }

  const openDelete = (h: AdminHouse) => {
    resetModalState()
    setDeleteHouse(h)
  }

  return (
    <div className="space-y-6 font-sans">
      {/* Header bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Quản Lý Nhà Nấm</h2>
          <p className="text-xs sm:text-sm text-slate-400">Danh sách khu vực / trại nấm rơm và thông số kỹ thuật</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => fetchHouses()}
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
            <span>Tạo Nhà Nấm Mới</span>
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

      {/* Houses Table */}
      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md shadow-xl">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-950/80 text-xs uppercase tracking-wider text-slate-300 font-semibold">
            <tr>
              <th className="px-5 py-4">Mã Nhà Nấm (ID)</th>
              <th className="px-5 py-4">Tên Nhà Nấm</th>
              <th className="px-5 py-4">Diện Tích</th>
              <th className="px-5 py-4">Số Trụ Nấm</th>
              <th className="px-5 py-4">Số Thiết Bị</th>
              <th className="px-5 py-4">Người Giám Sát</th>
              <th className="px-5 py-4 text-right">Thao Tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-slate-200">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                  Đang tải danh sách nhà nấm…
                </td>
              </tr>
            ) : houses.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                  Chưa có nhà nấm nào được tạo trong hệ thống.
                </td>
              </tr>
            ) : (
              houses.map((h) => (
                <tr key={h.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-5 py-4 font-bold text-emerald-400 font-mono text-sm">{h.id}</td>
                  <td className="px-5 py-4 text-white font-semibold text-base">{h.name}</td>
                  <td className="px-5 py-4 text-slate-300">{h.areaMeters} m²</td>
                  <td className="px-5 py-4 text-slate-300">{h.pillarCount} trụ</td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${
                        h.deviceCount > 0
                          ? 'border border-emerald-500/40 bg-emerald-950/60 text-emerald-300'
                          : 'border border-slate-700 bg-slate-800 text-slate-400'
                      }`}
                    >
                      {h.deviceCount} thiết bị
                    </span>
                  </td>
                  <td className="px-5 py-4 text-slate-300">{h.activeUserCount} người</td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(h)}
                        className="flex min-h-[40px] min-w-[40px] cursor-pointer items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-slate-200 hover:border-slate-500 hover:bg-slate-700 hover:text-white transition-colors"
                        title="Chỉnh sửa nhà nấm"
                      >
                        <Edit3 className="size-4" />
                        <span className="sr-only sm:not-sr-only sm:ml-1 text-xs">Sửa</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openDelete(h)}
                        className="flex min-h-[40px] min-w-[40px] cursor-pointer items-center justify-center rounded-xl border border-red-500/40 bg-red-950/40 px-3 py-2 text-red-300 hover:bg-red-900/60 transition-colors"
                        title="Xóa nhà nấm"
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only sm:not-sr-only sm:ml-1 text-xs">Xóa</span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <Home className="size-5 text-emerald-400" />
                Tạo Nhà Nấm Mới
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
                  <p className="font-bold text-red-300">Lỗi khi tạo nhà nấm:</p>
                  <p className="leading-relaxed text-red-100">{modalError}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-200 mb-1.5">
                  Mã Nhà Nấm (Mã viết liền không dấu)
                </label>
                <input
                  type="text"
                  required
                  pattern="^[a-z0-9_-]{3,50}$"
                  placeholder="Ví dụ: nha_b1, khu_a_phong_2"
                  value={houseId}
                  onChange={(e) => setHouseId(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-mono"
                />
                <p className="mt-1.5 text-xs text-slate-400">
                  Dùng làm mã phân biệt hệ thống. Chỉ viết chữ thường, số và gạch dưới (_).
                </p>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-200 mb-1.5">
                  Tên Hiển Thị Nhà Nấm
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: Trại Nấm Rơm Trại B1"
                  value={houseName}
                  onChange={(e) => setHouseName(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-200 mb-1.5">
                    Diện tích (m²)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="4x6"
                    value={areaMeters}
                    onChange={(e) => setAreaMeters(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-200 mb-1.5">
                    Số trụ nấm
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={500}
                    value={pillarCount}
                    onChange={(e) => setPillarCount(parseInt(e.target.value, 10))}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
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
                  {submitting ? 'Đang tạo…' : 'Tạo Nhà Nấm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit House */}
      {editHouse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base sm:text-lg font-bold text-white">Chỉnh Sửa Nhà Nấm: {editHouse.id}</h3>
              <button
                type="button"
                onClick={() => setEditHouse(null)}
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
                  <p className="font-bold text-red-300">Lỗi khi cập nhật nhà nấm:</p>
                  <p className="leading-relaxed text-red-100">{modalError}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleUpdate} className="space-y-4">
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-200 mb-1.5">Tên Hiển Thị Nhà Nấm</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-200 mb-1.5">Diện tích (m²)</label>
                  <input
                    type="text"
                    required
                    value={editArea}
                    onChange={(e) => setEditArea(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-200 mb-1.5">Số trụ nấm</label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={500}
                    value={editPillars}
                    onChange={(e) => setEditPillars(parseInt(e.target.value, 10))}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditHouse(null)}
                  className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 transition-colors disabled:opacity-50 shadow-md"
                >
                  {submitting ? 'Đang lưu…' : 'Cập Nhật Nhà Nấm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete House Confirmation */}
      {deleteHouse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 text-red-400">
              <h3 className="text-base sm:text-lg font-bold flex items-center gap-2">
                <AlertCircle className="size-5" />
                Xác Nhận Xóa Nhà Nấm
              </h3>
              <button
                type="button"
                onClick={() => setDeleteHouse(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Modal Error Alert */}
            {modalError && (
              <div className="flex items-start gap-3 rounded-xl border border-red-500/60 bg-red-950/80 p-3.5 text-xs sm:text-sm text-red-200 shadow-md">
                <AlertCircle className="size-5 shrink-0 text-red-400 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-red-300">Không thể xóa nhà nấm:</p>
                  <p className="leading-relaxed text-red-100">{modalError}</p>
                </div>
              </div>
            )}

            <p className="text-sm text-slate-200 leading-relaxed">
              Bạn có chắc chắn muốn xóa nhà nấm <strong className="text-white font-bold">{deleteHouse.name} ({deleteHouse.id})</strong> không?
            </p>

            {deleteHouse.deviceCount > 0 && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-950/40 p-3.5 text-xs sm:text-sm text-amber-200 space-y-1">
                <p className="font-bold text-amber-300">⚠️ Cảnh báo thiết bị liên kết:</p>
                <p>
                  Nhà nấm này hiện có <strong>{deleteHouse.deviceCount} thiết bị</strong> đang hoạt động. Bạn cần chuyển hoặc gỡ thiết bị khỏi nhà nấm này trước khi xóa.
                </p>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setDeleteHouse(null)}
                className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={submitting}
                className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-red-500/40 bg-red-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-500 transition-colors disabled:opacity-50 shadow-md"
              >
                {submitting ? 'Đang xóa…' : 'Đồng Ý Xóa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
