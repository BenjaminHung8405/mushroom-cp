import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST, resolveBearerToken, validateAndSanitizePath } from '@/app/api/backend/[...path]/route'

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
    it('allows valid device path segments', () => {
      expect(validateAndSanitizePath(['devices', 'DEV_001', 'tuning-configurations'])).toEqual([
        'devices',
        'DEV_001',
        'tuning-configurations',
      ])
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

  describe('Proxy Security & Auth Cases', () => {
    const params = Promise.resolve({ path: ['devices', 'DEV_001', 'tuning-configurations'] })

    it('Case 1: Anonymous request -> returns 401 directly at BFF without calling fetch', async () => {
      const req = new NextRequest('http://localhost:3000/api/backend/devices/DEV_001/tuning-configurations')
      const res = await GET(req, { params })

      expect(res.status).toBe(401)
      expect(fetch).not.toHaveBeenCalled()
      const data = await res.json()
      expect(data.message).toBe('Yêu cầu xác thực người dùng.')
    })

    it('Case 1b: Anonymous request with BFF_JWT_TOKEN set -> still returns 401 at BFF', async () => {
      process.env.BFF_JWT_TOKEN = 'super-secret-service-token'
      const req = new NextRequest('http://localhost:3000/api/backend/devices/DEV_001/tuning-configurations')
      const res = await GET(req, { params })

      expect(res.status).toBe(401)
      expect(fetch).not.toHaveBeenCalled()
    })

    it('Case 2: Valid authenticated user -> forwards Bearer header to upstream API_INTERNAL_URL', async () => {
      let requestedUrl: string | undefined
      let sentAuthHeader: string | undefined

      vi.mocked(fetch).mockImplementationOnce(async (url, init) => {
        requestedUrl = url.toString()
        const headers = (init?.headers ?? {}) as Record<string, string>
        sentAuthHeader = headers['Authorization']
        return new Response(JSON.stringify({ commandId: 'cmd-valid', status: 'PENDING' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        })
      })

      const req = new NextRequest('http://localhost:3000/api/backend/devices/DEV_001/tuning-configurations', {
        method: 'POST',
        headers: {
          cookie: 'session_token=valid-user-jwt',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ commandId: 'cmd-valid', config: {} }),
      })

      const res = await POST(req, { params })

      expect(requestedUrl).toBe('http://localhost:6002/devices/DEV_001/tuning-configurations')
      expect(sentAuthHeader).toBe('Bearer valid-user-jwt')
      expect(res.status).toBe(202)
    })

    it('Case 3: Malformed path segment -> returns 400 Bad Request without calling fetch', async () => {
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
