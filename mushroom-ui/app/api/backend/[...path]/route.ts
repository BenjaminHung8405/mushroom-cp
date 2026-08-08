import { NextRequest, NextResponse } from 'next/server'
import { SignJWT } from 'jose'

// SSE must be streamed through this gateway; never statically cache or buffer it.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const MAX_PROXY_BODY_BYTES = 64 * 1024 // 64 KB

function getBackendBaseUrl(): string {
  const configuredBackendBaseUrl =
    process.env.API_INTERNAL_URL ??
    (process.env.NODE_ENV === 'production'
      ? undefined
      : process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:6002')

  if (!configuredBackendBaseUrl) {
    throw new Error('API_INTERNAL_URL is required in production.')
  }

  return configuredBackendBaseUrl.replace(/\/$/, '')
}

const ALLOWED_TOP_LEVEL_PREFIXES = new Set([
  'auth',
  'admin',
  'devices',
  'batches',
  'analytics',
  'offline-sync',
  'health',
])

export const SYSTEM_TOKEN_TTL_SECONDS = 5 * 60
export const SYSTEM_ISSUER = 'mushroom-ui'
export const SYSTEM_AUDIENCE = 'mushroom-backend'
export const SYSTEM_SUBJECT = 'mushroom-ui-bff'

export function getSystemJwtSecret(): Uint8Array {
  const secret = process.env.SYSTEM_JWT_SECRET?.trim()

  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('SYSTEM_JWT_SECRET must be at least 32 bytes.')
  }

  return new TextEncoder().encode(secret)
}

export async function signSystemToken(
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  return new SignJWT({ roles: ['SYSTEM'] })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(SYSTEM_SUBJECT)
    .setIssuer(SYSTEM_ISSUER)
    .setAudience(SYSTEM_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + SYSTEM_TOKEN_TTL_SECONDS)
    .sign(getSystemJwtSecret())
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
  const backendBaseUrl = getBackendBaseUrl()
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

export async function buildForwardHeaders(request: NextRequest): Promise<Record<string, string>> {
  const mode = process.env.AUTH_ENFORCEMENT_MODE?.trim().toLowerCase() ?? 'shadow'
  const systemToken = mode === 'enforced' ? null : await signSystemToken()

  return {
    Accept: request.headers.get('accept') ?? 'application/json',
    ...(systemToken ? { Authorization: `Bearer ${systemToken}` } : {}),
    ...(request.headers.get('cookie') ? { Cookie: request.headers.get('cookie')! } : {}),
    ...(request.headers.get('content-type')
      ? { 'Content-Type': request.headers.get('content-type')! }
      : {}),
  }
}

export function forwardUpstreamResponse(response: Response): Response {
  const isEventStream = response.headers
    .get('content-type')
    ?.includes('text/event-stream')

  const headers = new Headers()
  headers.set('Content-Type', response.headers.get('content-type') ?? 'application/json')
  headers.set('Cache-Control', isEventStream ? 'no-cache, no-transform' : 'no-store')

  if ('getSetCookie' in response.headers && typeof response.headers.getSetCookie === 'function') {
    const cookies = response.headers.getSetCookie()
    for (const cookie of cookies) {
      headers.append('Set-Cookie', cookie)
    }
  } else {
    const setCookie = response.headers.get('set-cookie')
    if (setCookie) {
      headers.set('Set-Cookie', setCookie)
    }
  }

  if (isEventStream) {
    headers.set('Connection', 'keep-alive')
    headers.set('X-Accel-Buffering', 'no')
  }

  return new Response(response.body, {
    status: response.status,
    headers,
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
    // System-only mode: the BFF ignores browser credentials and signs its own
    // short-lived workload JWT for every upstream request.
    const headers = await buildForwardHeaders(request)
    const response = await fetch(urlResult.url, {
      method: request.method,
      headers,
      body: bodyResult.body,
      cache: 'no-store',
      signal: request.signal,
    })
    return forwardUpstreamResponse(response)
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return new Response(null, { status: 499 })
    }
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
