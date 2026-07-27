import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  CoverageWarning,
  isVietnameseText,
} from '@/app/components/tuning/CoverageWarning'

describe('isVietnameseText', () => {
  it('accepts strings that carry Vietnamese diacritics', () => {
    expect(isVietnameseText('Chưa đủ dữ liệu')).toBe(true)
    expect(isVietnameseText('Đèn sưởi bật')).toBe(true)
  })

  it('rejects plain English detail strings', () => {
    expect(isVietnameseText('No valid KPI data is available')).toBe(false)
    expect(isVietnameseText('')).toBe(false)
  })
})

describe('CoverageWarning', () => {
  it('replaces the raw English KPI detail with the Vietnamese fallback', () => {
    render(
      <CoverageWarning
        blockReason="INSUFFICIENT_DATA"
        detail="No valid KPI data is available for the requested observation window."
      />,
    )
    expect(screen.getByText('Chưa đủ dữ liệu tin cậy')).toBeInTheDocument()
    expect(
      screen.getByText(
        /Hệ thống chưa thể xác nhận đủ độ phủ và số mẫu hợp lệ/,
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/No valid KPI data is available/),
    ).not.toBeInTheDocument()
  })

  it('preserves an operator-provided Vietnamese detail', () => {
    render(
      <CoverageWarning
        blockReason="INSUFFICIENT_DATA"
        detail="Chưa đủ dữ liệu 6 giờ gần nhất"
      />,
    )
    expect(
      screen.getByText('Chưa đủ dữ liệu 6 giờ gần nhất'),
    ).toBeInTheDocument()
  })

  it('renders nothing when there is no block reason', () => {
    const { container } = render(
      <CoverageWarning blockReason={null} detail={null} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
