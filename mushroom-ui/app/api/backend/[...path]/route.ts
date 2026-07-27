import { NextRequest, NextResponse } from 'next/server'

// SSE must be streamed through this gateway; never statically cache or buffer it.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const backendBaseUrl = (
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:6002'
).replace(/\/$/, '')

const ALLOWED_TOP_LEVEL_PREFIXES = new Set(['devices', 'analytics', 'health'])

/**
 * Resolves Bearer JWT strictly from browser context:
 * 1. Authorization header in incoming request
 * 2. HttpOnly cookies (`session_token`, `auth_token`, `jwt`, `token`, `access_token`)
 *
 * NOTE: Server-side fallback tokens (e.g. BFF_JWT_TOKEN) are deliberately NOT
 * used here to prevent privilege escalation for unauthenticated browser requests.
 */
export function resolveBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization')
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim()
    if (token) return token
  }

  const cookieNames = ['session_token', 'auth_token', 'jwt', 'token', 'access_token']
  for (const name of cookieNames) {
    const val = request.cookies.get(name)?.value
    if (val && val.trim()) {
      return val.trim()
    }
  }

  return null
}

export function validateAndSanitizePath(pathSegments: string[]): string[] | null {
  if (!Array.isArray(pathSegments) || pathSegments.length === 0) return null

  if (!ALLOWED_TOP_LEVEL_PREFIXES.has(pathSegments[0])) return null

  const sanitized: string[] = []
  for (const seg of pathSegments) {
    if (!seg) return null
    if (seg === '.' || seg === '..') return null
    if (seg.includes('/') || seg.includes('\\')) return null

    try {
      const decoded = decodeURIComponent(seg)
      if (
        decoded.includes('/') ||
        decoded.includes('\\') ||
        decoded.includes('\0') ||
        decoded === '.' ||
        decoded === '..'
      ) {
        return null
      }
    } catch {
      return null
    }

    if (seg.startsWith('/') || seg.startsWith('\\')) return null

    sanitized.push(encodeURIComponent(decodeURIComponent(seg)))
  }

  return sanitized
}

/**
 * Same-origin proxy gateway to NestJS. Validates browser identity and path segments
 * before forwarding requests to the internal API URL.
 */
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const token = resolveBearerToken(request)
  if (!token) {
    return NextResponse.json(
      { message: 'Yêu cầu xác thực người dùng.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const { path } = await context.params
  const sanitizedPath = validateAndSanitizePath(path)
  if (!sanitizedPath) {
    return NextResponse.json(
      { message: 'Đường dẫn proxy không hợp lệ.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const safePath = '/' + sanitizedPath.join('/')
  const upstreamUrl = new URL(safePath, backendBaseUrl)

  // Enforce upstream origin safety to defend against open proxy / SSRF attacks.
  const targetOrigin = new URL(backendBaseUrl).origin
  if (upstreamUrl.origin !== targetOrigin) {
    return NextResponse.json(
      { message: 'Địa chỉ đích proxy bị cấm.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  upstreamUrl.search = request.nextUrl.search

  try {
    const headers: Record<string, string> = {
      Accept: request.headers.get('accept') ?? 'application/json',
      Authorization: `Bearer ${token}`,
      ...(request.headers.get('content-type')
        ? { 'Content-Type': request.headers.get('content-type')! }
        : {}),
    }

    const response = await fetch(upstreamUrl, {
      method: request.method,
      headers,
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
