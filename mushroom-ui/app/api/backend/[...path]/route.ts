import { NextRequest, NextResponse } from 'next/server'

// SSE must be streamed through this gateway; never statically cache or buffer it.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const MAX_PROXY_BODY_BYTES = 64 * 1024 // 64 KB

const backendBaseUrl = (
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:6002'
).replace(/\/$/, '')

const ALLOWED_TOP_LEVEL_PREFIXES = new Set([
  'devices',
  'batches',
  'analytics',
  'offline-sync',
  'health',
])

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
    if (!seg || seg === '.' || seg === '..') return null
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

export function buildValidatedUpstreamUrl(path: string[], search: string): { url: URL } | NextResponse {
  const sanitizedPath = validateAndSanitizePath(path)
  if (!sanitizedPath) {
    return NextResponse.json(
      { message: 'Đường dẫn proxy không hợp lệ.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const safePath = '/' + sanitizedPath.join('/')
  const upstreamUrl = new URL(safePath, backendBaseUrl)
  const targetOrigin = new URL(backendBaseUrl).origin

  if (upstreamUrl.origin !== targetOrigin) {
    return NextResponse.json(
      { message: 'Địa chỉ đích proxy bị cấm.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  upstreamUrl.search = search
  return { url: upstreamUrl }
}

export function buildForwardHeaders(request: NextRequest, token: string | null): Record<string, string> {
  return {
    Accept: request.headers.get('accept') ?? 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(request.headers.get('content-type')
      ? { 'Content-Type': request.headers.get('content-type')! }
      : {}),
  }
}

export function forwardUpstreamResponse(response: Response): Response {
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
}

export function validateMutationOrigin(request: NextRequest): NextResponse | null {
  const method = request.method.toUpperCase()
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const origin = request.headers.get('origin')
    const referer = request.headers.get('referer')
    // On a reverse-proxied deployment, nextUrl may contain the internal
    // container origin. Host is the public origin observed by the browser.
    const forwardedHost = request.headers.get('x-forwarded-host')
    const publicHost = forwardedHost ?? request.headers.get('host')
    const forwardedProtocol = request.headers.get('x-forwarded-proto')
    const publicOrigin = publicHost
      ? `${forwardedProtocol ?? request.nextUrl.protocol.replace(/:$/, '')}://${publicHost}`
      : request.nextUrl.origin
    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
      : [request.nextUrl.origin, publicOrigin]

    let requestOrigin: string | null = null
    if (origin) {
      requestOrigin = origin
    } else if (referer) {
      try {
        requestOrigin = new URL(referer).origin
      } catch {
        requestOrigin = null
      }
    }

    if (!requestOrigin || !allowedOrigins.includes(requestOrigin)) {
      return NextResponse.json(
        { message: 'Yêu cầu bị từ chối do nguồn gốc (Origin) không hợp lệ.' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      )
    }
  }
  return null
}

function checkContentLengthHeader(request: NextRequest, maxBytes: number): NextResponse | null {
  const contentLengthHeader = request.headers.get('content-length')
  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10)
    if (!isNaN(contentLength) && contentLength > maxBytes) {
      return NextResponse.json(
        { message: 'Kích thước dữ liệu vượt quá giới hạn cho phép.' },
        { status: 413, headers: { 'Cache-Control': 'no-store' } },
      )
    }
  }
  return null
}

export async function readRequestBodyWithLimit(
  request: NextRequest,
  maxBytes: number = MAX_PROXY_BODY_BYTES,
): Promise<{ body: ArrayBuffer | undefined } | NextResponse> {
  const method = request.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD') {
    return { body: undefined }
  }

  const lengthError = checkContentLengthHeader(request, maxBytes)
  if (lengthError) return lengthError

  if (!request.body) return { body: undefined }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        totalBytes += value.byteLength
        if (totalBytes > maxBytes) {
          await reader.cancel()
          return NextResponse.json(
            { message: 'Kích thước dữ liệu vượt quá giới hạn cho phép.' },
            { status: 413, headers: { 'Cache-Control': 'no-store' } },
          )
        }
        chunks.push(value)
      }
    }
  } catch {
    return NextResponse.json(
      { message: 'Không thể đọc nội dung yêu cầu.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const combined = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }

  return { body: combined.buffer }
}

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const originResult = validateMutationOrigin(request)
  if (originResult) return originResult

  const { path } = await context.params

  const urlResult = buildValidatedUpstreamUrl(path, request.nextUrl.search)
  if (urlResult instanceof NextResponse) return urlResult

  const bodyResult = await readRequestBodyWithLimit(request)
  if (bodyResult instanceof NextResponse) return bodyResult

  try {
    // Non-user mode: an optional client token is preserved when supplied, but
    // the BFF does not require one before forwarding to the backend.
    const headers = buildForwardHeaders(request, resolveBearerToken(request))
    const response = await fetch(urlResult.url, {
      method: request.method,
      headers,
      body: bodyResult.body,
      cache: 'no-store',
    })
    return forwardUpstreamResponse(response)
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
export const DELETE = proxy
