import { NextResponse } from 'next/server'

const backendBaseUrl = (
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:6002'
).replace(/\/$/, '')

/**
 * Same-origin proxy for the device registry.
 *
 * The browser must never call localhost:3001: on a deployed user's device,
 * that address refers to the user's own machine rather than the Nest service.
 */
export async function GET() {
  try {
    const response = await fetch(`${backendBaseUrl}/devices`, {
      cache: 'no-store',
    })

    const body = await response.text()
    return new NextResponse(body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return NextResponse.json(
      { message: 'Không thể kết nối tới dịch vụ thiết bị.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
