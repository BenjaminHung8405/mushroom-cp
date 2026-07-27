import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GET,
  PATCH,
  buildForwardHeaders,
  buildValidatedUpstreamUrl,
  forwardUpstreamResponse,
  resolveBearerToken,
  validateAndSanitizePath,
  validateMutationOrigin,
} from '@/app/api/backend/[...path]/route'

describe('BFF Route Proxy Non-User Mode & SSRF Defense', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    delete process.env.BFF_JWT_TOKEN
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.BFF_JWT_TOKEN
  })

  describe('resolveBearerToken helper', () => {
    it('extracts token from Authorization Bearer header', () => {
      const req = new NextRequest('http://localhost:3000/api/backend/devices/DEV_001', {
        headers: { Authorization: 'Bearer token-header-123' },
      })
      expect(resolveBearerToken(req)).toBe('token-header-123')
    })

    it('extracts token from cookies if Authorization header is missing', () => {
      const req = new NextRequest('http://localhost:3000/api/backend/devices/DEV_001', {
        headers: { cookie: 'session_token=cookie-token-456' },
      })
      expect(resolveBearerToken(req)).toBe('cookie-token-456')
    })

    it('does NOT use BFF_JWT_TOKEN env fallback (returns null)', () => {
      process.env.BFF_JWT_TOKEN = 'env-token-789'
      const req = new NextRequest('http://localhost:3000/api/backend/devices/DEV_001')
      expect(resolveBearerToken(req)).toBeNull()
    })

    it('returns null if no token is available', () => {
      const req = new NextRequest('http://localhost:3000/api/backend/devices/DEV_001')
      expect(resolveBearerToken(req)).toBeNull()
    })
  })

  describe('Path sanitization and SSRF validation', () => {
    it('allows valid device, batches, analytics, offline-sync, and health prefixes', () => {
      expect(validateAndSanitizePath(['devices', 'DEV_001'])).toEqual(['devices', 'DEV_001'])
      expect(validateAndSanitizePath(['batches', 'active', 'house-1'])).toEqual([
        'batches',
        'active',
        'house-1',
      ])
      expect(validateAndSanitizePath(['analytics', 'kpi'])).toEqual(['analytics', 'kpi'])
      expect(validateAndSanitizePath(['offline-sync', 'DEV_001', 'history'])).toEqual([
        'offline-sync',
        'DEV_001',
        'history',
      ])
      expect(validateAndSanitizePath(['health'])).toEqual(['health'])
    })

    it('rejects unallowed top-level prefixes', () => {
      expect(validateAndSanitizePath(['admin', 'users'])).toBeNull()
      expect(validateAndSanitizePath(['internal', 'secret'])).toBeNull()
    })

    it('rejects path traversal dot segments', () => {
      expect(validateAndSanitizePath(['devices', '..', 'admin'])).toBeNull()
      expect(validateAndSanitizePath(['devices', '.'])).toBeNull()
    })

    it('rejects raw slashes and backslashes in segments', () => {
      expect(validateAndSanitizePath(['devices', 'DEV/001'])).toBeNull()
      expect(validateAndSanitizePath(['devices', 'DEV\\001'])).toBeNull()
      expect(validateAndSanitizePath(['devices', '//evil.com'])).toBeNull()
    })

    it('rejects percent-encoded slashes, backslashes, and null bytes', () => {
      expect(validateAndSanitizePath(['devices', '%2F%2Fevil.com'])).toBeNull()
      expect(validateAndSanitizePath(['devices', '..%2Fadmin'])).toBeNull()
      expect(validateAndSanitizePath(['devices', 'test%00byte'])).toBeNull()
    })
  })

  describe('Proxy helper functions', () => {
    it('buildValidatedUpstreamUrl returns valid URL or 400 response', () => {
      const result = buildValidatedUpstreamUrl(['batches', 'active', 'house-1'], '?window=24')
      expect('url' in result && result.url.toString()).toBe(
        'http://localhost:6002/batches/active/house-1?window=24',
      )

      const badResult = buildValidatedUpstreamUrl(['invalid_prefix'], '')
      expect('status' in badResult && badResult.status).toBe(400)
    })

    it('buildForwardHeaders builds headers with Bearer token', () => {
      const req = new NextRequest('http://localhost:3000/api/backend/batches', {
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      })
      const headers = buildForwardHeaders(req, 'token-123')
      expect(headers).toEqual({
        Accept: 'application/json',
        Authorization: 'Bearer token-123',
        'Content-Type': 'application/json',
      })
    })

    it('buildForwardHeaders omits Authorization when the client did not provide a token', () => {
      const req = new NextRequest('http://localhost:3000/api/backend/devices')
      expect(buildForwardHeaders(req, null)).toEqual({ Accept: 'application/json' })
    })

    it('accepts a mutation from the public forwarded origin behind a reverse proxy', () => {
      const req = new NextRequest('http://mushroom-ui:3000/api/backend/devices/DEV_001/tuning-configurations', {
        method: 'POST',
        headers: {
          Origin: 'https://mushroomapp.mitelai.com',
          Host: 'mushroomapp.mitelai.com',
          'X-Forwarded-Proto': 'https',
        },
      })

      expect(validateMutationOrigin(req)).toBeNull()
    })

    it('forwardUpstreamResponse formats normal and event-stream responses', async () => {
      const normalUpstream = new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
      const normalRes = forwardUpstreamResponse(normalUpstream)
      expect(normalRes.status).toBe(200)
      expect(normalRes.headers.get('Cache-Control')).toBe('no-store')

      const sseUpstream = new Response('data: hello\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
      const sseRes = forwardUpstreamResponse(sseUpstream)
      expect(sseRes.status).toBe(200)
      expect(sseRes.headers.get('Cache-Control')).toBe('no-cache, no-transform')
      expect(sseRes.headers.get('Connection')).toBe('keep-alive')
    })
  })

  describe('Proxy Security & Route Coverage Cases', () => {
    it('Case 0: Anonymous SSE request forwards without Authorization', async () => {
      let forwardedAuthorization: string | null | undefined
      vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
        forwardedAuthorization = new Headers(init?.headers).get('Authorization')
        return new Response('event: device-status\ndata: {}\n\n', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      })

      const params = Promise.resolve({ path: ['devices', 'status', 'stream'] })
      const req = new NextRequest('http://localhost:3000/api/backend/devices/status/stream')
      const res = await GET(req, { params })

      expect(res.status).toBe(200)
      expect(forwardedAuthorization).toBeNull()
    })

    it('Case 1: Anonymous request to a formerly guarded route forwards without Authorization', async () => {
      let forwardedAuthorization: string | null | undefined
      vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
        forwardedAuthorization = new Headers(init?.headers).get('Authorization')
        return new Response(JSON.stringify({ message: 'Bearer JWT is required.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      })

      const params = Promise.resolve({ path: ['devices', 'DEV_001', 'tuning-configurations'] })
      const req = new NextRequest('http://localhost:3000/api/backend/devices/DEV_001/tuning-configurations')
      const res = await GET(req, { params })

      expect(res.status).toBe(401)
      expect(fetch).toHaveBeenCalledOnce()
      expect(forwardedAuthorization).toBeNull()
      const data = await res.json()
      expect(data.message).toBe('Bearer JWT is required.')
    })

    it('Case 2: Authenticated batches request forwards request and token to /batches/active/house-1', async () => {
      let requestedUrl: string | undefined
      let forwardedAuthorization: string | null | undefined
      vi.mocked(fetch).mockImplementationOnce(async (url, init) => {
        requestedUrl = url.toString()
        forwardedAuthorization = new Headers(init?.headers).get('Authorization')
        return new Response(JSON.stringify({ id: 'batch-1', status: 'ACTIVE' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })

      const params = Promise.resolve({ path: ['batches', 'active', 'house-1'] })
      const req = new NextRequest('http://localhost:3000/api/backend/batches/active/house-1', {
        headers: { Authorization: 'Bearer valid-jwt' },
      })
      const res = await GET(req, { params })

      expect(requestedUrl).toBe('http://localhost:6002/batches/active/house-1')
      expect(forwardedAuthorization).toBe('Bearer valid-jwt')
      expect(res.status).toBe(200)
    })

    it('Case 3: Anonymous PATCH request forwards to backend when Origin matches', async () => {
      let requestedUrl: string | undefined
      let forwardedAuthorization: string | null | undefined
      vi.mocked(fetch).mockImplementationOnce(async (url, init) => {
        requestedUrl = url.toString()
        forwardedAuthorization = new Headers(init?.headers).get('Authorization')
        return new Response(null, { status: 204 })
      })

      const params = Promise.resolve({ path: ['batches', 'batch-1', 'end'] })
      const req = new NextRequest('http://localhost:3000/api/backend/batches/batch-1/end', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({ status: 'COMPLETED' }),
      })
      const res = await PATCH(req, { params })

      expect(requestedUrl).toBe('http://localhost:6002/batches/batch-1/end')
      expect(forwardedAuthorization).toBeNull()
      expect(res.status).toBe(204)
    })

    it('Case 4: Malformed path segment -> returns 400 Bad Request', async () => {
      const badParams = Promise.resolve({ path: ['devices', '//evil.com', 'tuning-configurations'] })
      const req = new NextRequest('http://localhost:3000/api/backend/devices//evil.com/tuning-configurations', {
        headers: { Authorization: 'Bearer valid-jwt' },
      })

      const res = await GET(req, { params: badParams })

      expect(res.status).toBe(400)
      expect(fetch).not.toHaveBeenCalled()
      const data = await res.json()
      expect(data.message).toBe('Đường dẫn proxy không hợp lệ.')
    })

    it('Case 5: Cross-origin mutation requests (POST/PATCH/DELETE) -> returns 403 Forbidden without calling backend fetch', async () => {
      const params = Promise.resolve({ path: ['devices', 'DEV_001', 'tuning-configurations'] })

      const crossOriginReq = new NextRequest(
        'http://localhost:3000/api/backend/devices/DEV_001/tuning-configurations',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-jwt',
            'Content-Type': 'application/json',
            Origin: 'http://evil-attacker.com',
          },
          body: JSON.stringify({ commandId: 'c1' }),
        },
      )

      const res = await GET(crossOriginReq, { params })

      expect(res.status).toBe(403)
      expect(fetch).not.toHaveBeenCalled()
      const data = await res.json()
      expect(data.message).toBe('Yêu cầu bị từ chối do nguồn gốc (Origin) không hợp lệ.')
    })

    it('Case 6: Body larger than 64KB with Content-Length header -> returns 413 without calling fetch', async () => {
      const params = Promise.resolve({ path: ['devices', 'DEV_001', 'tuning-configurations'] })
      const req = new NextRequest(
        'http://localhost:3000/api/backend/devices/DEV_001/tuning-configurations',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-jwt',
            'Content-Type': 'application/json',
            'Content-Length': '70000',
            Origin: 'http://localhost:3000',
          },
          body: new Uint8Array(70000),
        },
      )

      const res = await PATCH(req, { params })
      expect(res.status).toBe(413)
      expect(fetch).not.toHaveBeenCalled()
      const data = await res.json()
      expect(data.message).toBe('Kích thước dữ liệu vượt quá giới hạn cho phép.')
    })

    it('Case 7: Chunked body larger than 64KB without Content-Length -> returns 413 during streaming read', async () => {
      const params = Promise.resolve({ path: ['devices', 'DEV_001', 'tuning-configurations'] })
      const largeBody = new Uint8Array(70000)
      const req = new NextRequest(
        'http://localhost:3000/api/backend/devices/DEV_001/tuning-configurations',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-jwt',
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
          },
          body: largeBody,
        },
      )

      const res = await PATCH(req, { params })
      expect(res.status).toBe(413)
      expect(fetch).not.toHaveBeenCalled()
    })
  })
})
