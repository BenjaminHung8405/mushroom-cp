import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GET,
  PATCH,
  authenticateBrowserRequest,
  buildForwardHeaders,
  buildValidatedUpstreamUrl,
  forwardUpstreamResponse,
  resolveBearerToken,
  validateAndSanitizePath,
} from '@/app/api/backend/[...path]/route'

describe('BFF Route Proxy Authentication & SSRF Defense', () => {
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
    it('authenticateBrowserRequest returns token or 401 response', () => {
      const reqAuth = new NextRequest('http://localhost:3000/api/backend/devices', {
        headers: { Authorization: 'Bearer valid-jwt' },
      })
      const authRes = authenticateBrowserRequest(reqAuth)
      expect(authRes).toEqual({ token: 'valid-jwt' })

      const reqAnon = new NextRequest('http://localhost:3000/api/backend/devices')
      const anonRes = authenticateBrowserRequest(reqAnon)
      expect('status' in anonRes && anonRes.status).toBe(401)
    })

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
    it('Case 1: Anonymous request -> returns 401 directly at BFF', async () => {
      const params = Promise.resolve({ path: ['devices', 'DEV_001', 'tuning-configurations'] })
      const req = new NextRequest('http://localhost:3000/api/backend/devices/DEV_001/tuning-configurations')
      const res = await GET(req, { params })

      expect(res.status).toBe(401)
      expect(fetch).not.toHaveBeenCalled()
      const data = await res.json()
      expect(data.message).toBe('Yêu cầu xác thực người dùng.')
    })

    it('Case 2: Valid batches request -> forwards request to /batches/active/house-1', async () => {
      let requestedUrl: string | undefined
      vi.mocked(fetch).mockImplementationOnce(async (url) => {
        requestedUrl = url.toString()
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
      expect(res.status).toBe(200)
    })

    it('Case 3: Valid PATCH /batches/batch-1/end request -> forwards to backend', async () => {
      let requestedUrl: string | undefined
      vi.mocked(fetch).mockImplementationOnce(async (url) => {
        requestedUrl = url.toString()
        return new Response(null, { status: 204 })
      })

      const params = Promise.resolve({ path: ['batches', 'batch-1', 'end'] })
      const req = new NextRequest('http://localhost:3000/api/backend/batches/batch-1/end', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer valid-jwt', 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED' }),
      })
      const res = await PATCH(req, { params })

      expect(requestedUrl).toBe('http://localhost:6002/batches/batch-1/end')
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
  })
})
