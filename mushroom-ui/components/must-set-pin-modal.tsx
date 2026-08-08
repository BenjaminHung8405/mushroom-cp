'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { authApi } from '@/lib/auth-api'
import { formatPhoneNumber } from '@/lib/kiosk-storage'
import { KeyRound, Check, AlertCircle, Delete, ArrowRight, RefreshCw, LogOut, Eye, EyeOff, Info } from 'lucide-react'

interface MustSetPinModalProps {
  phoneNumber: string
  onSuccess: () => void
  onLogout: () => void
}

function isWeakPin(pin: string): boolean {
  if (/^(\d)\1{5}$/.test(pin)) return true
  const sequential = [
    '012345', '123456', '234567', '345678', '456789', '567890',
    '987654', '876543', '765432', '654321', '543210'
  ]
  return sequential.includes(pin)
}

export function MustSetPinModal({ phoneNumber, onSuccess, onLogout }: MustSetPinModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [showPin, setShowPin] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const vibrate = () => {
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(50)
      } catch {
        // ignore
      }
    }
  }

  const getActivePin = useCallback(() => {
    if (step === 1) return currentPin
    if (step === 2) return newPin
    return confirmPin
  }, [step, currentPin, newPin, confirmPin])

  const handleKeyPress = useCallback((digit: string) => {
    vibrate()
    setError(null)
    const active = getActivePin()
    if (active.length >= 6) return

    const next = active + digit
    if (step === 1) setCurrentPin(next)
    else if (step === 2) setNewPin(next)
    else setConfirmPin(next)
  }, [step, getActivePin])

  const handleDelete = useCallback(() => {
    vibrate()
    setError(null)
    const active = getActivePin()
    if (!active) return

    const next = active.slice(0, -1)
    if (step === 1) setCurrentPin(next)
    else if (step === 2) setNewPin(next)
    else setConfirmPin(next)
  }, [step, getActivePin])

  const handleClear = useCallback(() => {
    vibrate()
    setError(null)
    if (step === 1) setCurrentPin('')
    else if (step === 2) setNewPin('')
    else setConfirmPin('')
  }, [step])

  const handleNextStep1 = useCallback(() => {
    if (currentPin.length !== 6) {
      setError('Vui lòng nhập đủ 6 chữ số PIN hiện tại.')
      return
    }
    setError(null)
    setStep(2)
  }, [currentPin])

  const handleNextStep2 = useCallback(() => {
    if (newPin.length !== 6) {
      setError('Vui lòng nhập đủ 6 chữ số PIN mới.')
      return
    }
    if (newPin === currentPin) {
      setError('Mã PIN mới phải khác mã PIN ban đầu.')
      setNewPin('')
      return
    }
    if (isWeakPin(newPin)) {
      setError('PIN quá đơn giản. Vui lòng không dùng các dãy số lặp lại hoặc liên tiếp (ví dụ: 123456, 111111).')
      setNewPin('')
      return
    }
    setError(null)
    setStep(3)
  }, [newPin, currentPin])

  const handleFinalSubmit = useCallback(async () => {
    if (confirmPin.length !== 6) {
      setError('Vui lòng nhập đủ 6 chữ số xác nhận PIN.')
      return
    }
    if (newPin !== confirmPin) {
      setError('Mã PIN xác nhận không trùng khớp với PIN mới. Vui lòng nhập lại.')
      setConfirmPin('')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      await authApi.setPin(currentPin, newPin)
      setSuccess(true)
      setTimeout(() => {
        onSuccess()
      }, 1500)
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Không thể cập nhật mã PIN.'
      setError(errMsg)
      setSubmitting(false)

      // SMART STEP ROUTING FOR UX:
      // If error is about current PIN, return to Step 1 and reset all inputs
      if (errMsg.toLowerCase().includes('hiện tại') || errMsg.toLowerCase().includes('current')) {
        setStep(1)
        setCurrentPin('')
        setNewPin('')
        setConfirmPin('')
      } else {
        // If error is about weak PIN or general PIN validation (400 Bad Request),
        // automatically return to Step 2 and clear textfield for seamless UX
        setStep(2)
        setNewPin('')
        setConfirmPin('')
      }
    }
  }, [currentPin, newPin, confirmPin, onSuccess])

  // Physical Keyboard Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (submitting || success) return

      if (e.key >= '0' && e.key <= '9') {
        handleKeyPress(e.key)
      } else if (e.key === 'Backspace') {
        handleDelete()
      } else if (e.key === 'Escape') {
        handleClear()
      } else if (e.key === 'Enter') {
        if (step === 1 && currentPin.length === 6) handleNextStep1()
        else if (step === 2 && newPin.length === 6) handleNextStep2()
        else if (step === 3 && confirmPin.length === 6) handleFinalSubmit()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    step,
    currentPin,
    newPin,
    confirmPin,
    submitting,
    success,
    handleKeyPress,
    handleDelete,
    handleClear,
    handleNextStep1,
    handleNextStep2,
    handleFinalSubmit,
  ])

  const activePin = getActivePin()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-xl p-4 select-none overflow-y-auto">
      {/* Ambient background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[350px] bg-amber-500/10 blur-[130px] pointer-events-none rounded-full" />

      <div className="relative w-full max-w-lg rounded-3xl border border-amber-500/40 bg-slate-950/95 p-6 sm:p-8 shadow-2xl space-y-5 text-slate-100 z-10">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="size-14 mx-auto rounded-2xl border border-amber-500/40 bg-amber-950/50 flex items-center justify-center text-amber-400 shadow-lg shadow-amber-950/50">
            <KeyRound className="size-7" />
          </div>
          <h2 className="font-mono text-xl sm:text-2xl font-bold tracking-tight text-amber-400">
            Yêu Cầu Đổi Mã PIN Ban Đầu
          </h2>
          <p className="text-sm font-sans text-slate-300 leading-relaxed max-w-md mx-auto">
            Tài khoản <strong className="text-white font-mono">{formatPhoneNumber(phoneNumber)}</strong> vừa được cấp hoặc đặt lại PIN. Hãy thiết lập PIN 6 số riêng để tiếp tục.
          </p>
        </div>

        {/* Visual Step Indicator (StepProgress) */}
        <div className="flex items-center justify-between px-4 py-3 rounded-2xl border border-slate-800 bg-slate-900/60">
          <button
            type="button"
            onClick={() => {
              if (step > 1) {
                setError(null)
                setStep(1)
              }
            }}
            className={`flex items-center gap-2 text-xs font-mono font-bold cursor-pointer transition-colors ${
              step === 1 ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span className={`size-6 rounded-full flex items-center justify-center text-[11px] ${step === 1 ? 'bg-amber-500 text-slate-950 font-extrabold' : 'bg-slate-800 text-slate-300'}`}>1</span>
            <span className="hidden sm:inline">PIN Hiện Tại</span>
          </button>

          <div className="h-0.5 w-6 bg-slate-800" />

          <button
            type="button"
            onClick={() => {
              if (step > 2 && currentPin.length === 6) {
                setError(null)
                setStep(2)
              }
            }}
            className={`flex items-center gap-2 text-xs font-mono font-bold cursor-pointer transition-colors ${
              step === 2 ? 'text-amber-400' : step > 2 ? 'text-slate-300 hover:text-white' : 'text-slate-500 cursor-not-allowed'
            }`}
          >
            <span className={`size-6 rounded-full flex items-center justify-center text-[11px] ${step === 2 ? 'bg-amber-500 text-slate-950 font-extrabold' : 'bg-slate-800 text-slate-300'}`}>2</span>
            <span className="hidden sm:inline">PIN Mới 6 Số</span>
          </button>

          <div className="h-0.5 w-6 bg-slate-800" />

          <div className={`flex items-center gap-2 text-xs font-mono font-bold ${step === 3 ? 'text-amber-400' : 'text-slate-500'}`}>
            <span className={`size-6 rounded-full flex items-center justify-center text-[11px] ${step === 3 ? 'bg-amber-500 text-slate-950 font-extrabold' : 'bg-slate-800 text-slate-400'}`}>3</span>
            <span className="hidden sm:inline">Xác Nhận PIN</span>
          </div>
        </div>

        {/* Step Instructions */}
        <div className="flex items-center justify-between text-slate-200">
          <div className="font-mono text-sm font-semibold">
            {step === 1 && 'Bước 1: Nhập mã PIN hiện tại (6 chữ số ban đầu)'}
            {step === 2 && 'Bước 2: Nhập mã PIN 6 số mới cho tài khoản'}
            {step === 3 && 'Bước 3: Nhập lại mã PIN mới để xác nhận'}
          </div>
          <button
            type="button"
            onClick={() => setShowPin(!showPin)}
            className="flex items-center gap-1 text-xs font-mono text-slate-400 hover:text-white cursor-pointer px-2 py-1 rounded-lg border border-slate-800 bg-slate-900/60"
            title={showPin ? 'Ẩn số PIN' : 'Hiện số PIN'}
          >
            {showPin ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            <span>{showPin ? 'Ẩn' : 'Hiện'}</span>
          </button>
        </div>

        {/* 6-Digit PIN Display Indicator */}
        <div className="flex justify-center gap-2.5 sm:gap-3 py-1">
          {Array.from({ length: 6 }).map((_, idx) => {
            const filled = idx < activePin.length
            const digitChar = activePin[idx]
            return (
              <div
                key={idx}
                className={`size-11 sm:size-12 rounded-2xl border-2 flex items-center justify-center font-mono text-lg font-bold transition-all duration-200 ${
                  filled
                    ? 'border-amber-400 bg-amber-500/20 text-amber-300 shadow-md shadow-amber-950/40 scale-105'
                    : 'border-slate-800 bg-slate-900/80 text-slate-600'
                }`}
              >
                {filled ? (
                  showPin ? (
                    digitChar
                  ) : (
                    <span className="size-3.5 rounded-full bg-amber-400 shadow-sm" />
                  )
                ) : (
                  <span className="size-2 rounded-full bg-slate-700" />
                )}
              </div>
            )
          })}
        </div>

        {/* Fixed Height Reserved Notification Slot — Prevents Layout Shift / UI Jumps */}
        <div className="min-h-[56px] flex items-center justify-center">
          {error ? (
            <div className="w-full flex items-start gap-2.5 rounded-2xl border border-red-500/40 bg-red-950/90 p-3.5 text-xs sm:text-sm font-sans font-semibold text-red-200 transition-opacity duration-200">
              <AlertCircle className="size-5 shrink-0 text-red-400 mt-0.5" />
              <span className="leading-snug">{error}</span>
            </div>
          ) : success ? (
            <div className="w-full flex items-center gap-2.5 rounded-2xl border border-emerald-500/40 bg-emerald-950/90 p-3.5 text-xs sm:text-sm font-sans font-semibold text-emerald-200 transition-opacity duration-200">
              <Check className="size-5 shrink-0 text-emerald-400" />
              <span>Đã đổi mã PIN thành công! Đang tự động chuyển hướng…</span>
            </div>
          ) : (
            <div className="w-full flex items-center gap-2 rounded-2xl border border-slate-800/80 bg-slate-900/40 px-3.5 py-2.5 text-xs font-sans text-slate-400 transition-opacity duration-200">
              <Info className="size-4 shrink-0 text-slate-500" />
              <span>
                {step === 1 && 'Nhập 6 số PIN ban đầu được Admin cấp.'}
                {step === 2 && 'Tránh dùng số lặp lại (111111) hoặc sảnh tăng (123456).'}
                {step === 3 && 'Nhập đúng 6 chữ số trùng khớp với PIN vừa nhập ở Bước 2.'}
              </span>
            </div>
          )}
        </div>

        {/* Touchscreen Numpad (Minimum 64px Touch Target) */}
        <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              type="button"
              disabled={submitting || success}
              onClick={() => handleKeyPress(digit)}
              className="h-16 rounded-2xl border border-slate-800 bg-slate-900/90 font-mono text-xl font-bold text-white shadow-md transition-all duration-150 hover:bg-slate-800 hover:border-slate-700 active:scale-95 cursor-pointer flex items-center justify-center disabled:opacity-40"
            >
              {digit}
            </button>
          ))}

          <button
            type="button"
            disabled={submitting || success || !activePin}
            onClick={handleClear}
            className="h-16 rounded-2xl border border-slate-800 bg-slate-900/50 font-mono text-xs font-semibold text-slate-400 hover:bg-slate-800 transition-all duration-150 active:scale-95 cursor-pointer flex items-center justify-center disabled:opacity-30"
          >
            Xóa hết
          </button>

          <button
            type="button"
            disabled={submitting || success}
            onClick={() => handleKeyPress('0')}
            className="h-16 rounded-2xl border border-slate-800 bg-slate-900/90 font-mono text-xl font-bold text-white shadow-md transition-all duration-150 hover:bg-slate-800 hover:border-slate-700 active:scale-95 cursor-pointer flex items-center justify-center disabled:opacity-40"
          >
            0
          </button>

          <button
            type="button"
            disabled={submitting || success || !activePin}
            onClick={handleDelete}
            className="h-16 rounded-2xl border border-slate-800 bg-slate-900/50 font-mono text-slate-300 hover:bg-slate-800 transition-all duration-150 active:scale-95 cursor-pointer flex items-center justify-center disabled:opacity-30"
            title="Xóa chữ số cuối"
          >
            <Delete className="size-6" />
          </button>
        </div>

        {/* Controls / Next Step Action */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={onLogout}
            className="flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <LogOut className="size-4" />
            <span>Đăng xuất</span>
          </button>

          {step === 1 && (
            <button
              type="button"
              disabled={currentPin.length !== 6}
              onClick={handleNextStep1}
              className="flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-600 px-6 py-2.5 font-mono text-sm font-bold text-slate-950 hover:bg-amber-500 transition-all shadow-lg active:scale-95 disabled:opacity-40"
            >
              <span>Tiếp Theo (Bước 2)</span>
              <ArrowRight className="size-4" />
            </button>
          )}

          {step === 2 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  setStep(1)
                }}
                className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-slate-800 px-3.5 py-2.5 text-xs font-semibold text-slate-400 hover:bg-slate-900"
              >
                Quay lại
              </button>
              <button
                type="button"
                disabled={newPin.length !== 6}
                onClick={handleNextStep2}
                className="flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-600 px-6 py-2.5 font-mono text-sm font-bold text-slate-950 hover:bg-amber-500 transition-all shadow-lg active:scale-95 disabled:opacity-40"
              >
                <span>Tiếp Theo (Bước 3)</span>
                <ArrowRight className="size-4" />
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  setStep(2)
                }}
                className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-slate-800 px-3.5 py-2.5 text-xs font-semibold text-slate-400 hover:bg-slate-900"
              >
                Quay lại
              </button>
              <button
                type="button"
                disabled={confirmPin.length !== 6 || submitting || success}
                onClick={handleFinalSubmit}
                className="flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500 px-6 py-2.5 font-mono text-sm font-bold text-slate-950 hover:bg-amber-400 transition-all shadow-lg shadow-amber-950/50 active:scale-95 disabled:opacity-40"
              >
                {submitting ? (
                  <>
                    <RefreshCw className="size-4 animate-spin" />
                    <span>Đang Đổi PIN…</span>
                  </>
                ) : (
                  <>
                    <Check className="size-4" />
                    <span>Hoàn Thành Đổi PIN</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
