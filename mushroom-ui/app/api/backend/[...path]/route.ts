import { NextRequest, NextResponse } from 'next/server'

// SSE must be streamed through this gateway; never statically cache or buffer it.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const backendBaseUrl = (
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:6002'
).replace(/\/$/, '')

/**
 * Same-origin gateway to NestJS. This keeps browser code independent of Docker
 * port mappings and prevents a deployed browser from calling its own localhost.
 */
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params
  const upstreamUrl = new URL(`/${path.join('/')}`, backendBaseUrl)
  upstreamUrl.search = request.nextUrl.search

  try {
    const response = await fetch(upstreamUrl, {
      method: request.method,
      headers: {
        Accept: request.headers.get('accept') ?? 'application/json',
        ...(request.headers.get('content-type')
          ? { 'Content-Type': request.headers.get('content-type')! }
          : {}),
        ...(request.headers.get('authorization')
          ? { Authorization: request.headers.get('authorization')! }
          : {}),
      },
      body:
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : await request.arrayBuffer(),
      cache: 'no-store',
    })

    const isEventStream = response.headers
      .get('content-type')
      ?.includes('text/event-stream')

    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') ?? 'application/json',
        // Prevent Next.js, reverse proxies, and browsers from buffering SSE events.
        'Cache-Control': isEventStream ? 'no-cache, no-transform' : 'no-store',
        ...(isEventStream
          ? {
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
            }
          : {}),
      },
    })
  } catch {
    return NextResponse.json(
      { message: 'Không thể kết nối tới dịch vụ backend.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
