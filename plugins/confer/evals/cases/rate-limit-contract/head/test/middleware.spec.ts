import assert from 'node:assert/strict'
import type { ServerResponse } from 'node:http'
import { test } from 'node:test'
import { RateLimiter } from '../src/limiter.ts'
import { rateLimit } from '../src/middleware.ts'
import type { ApiRequest } from '../src/router.ts'
import type { Tenant } from '../src/tenants.ts'

const acme: Tenant = { id: 'acme', name: 'Acme Travel', region: 'us', plan: 'free' }

function request(tenant: Tenant, route: string): ApiRequest {
  return { tenant, route, params: {} } as unknown as ApiRequest
}

function response() {
  const headers = new Map<string, string>()
  const res = {
    statusCode: 200,
    body: '',
    headers,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value)
    },
    end(body = '') {
      res.body = body
    },
  }
  return res
}

function send(limiter: RateLimiter, req: ApiRequest) {
  const res = response()
  let passed = false
  rateLimit(limiter)(req, res as unknown as ServerResponse, () => (passed = true))
  return { res, passed }
}

test('passes an allowed request on with the limit headers', () => {
  const { res, passed } = send(new RateLimiter(() => 0), request(acme, 'GET /v1/bookings/:id'))
  assert.equal(passed, true)
  assert.equal(res.headers.get('ratelimit-limit'), '30')
  assert.equal(res.headers.get('ratelimit-remaining'), '29')
  assert.equal(res.headers.get('ratelimit-reset'), '2')
})

test('reports the limit of the route rather than the plan', () => {
  const { res } = send(new RateLimiter(() => 0), request(acme, 'GET /v1/search'))
  assert.equal(res.headers.get('ratelimit-limit'), '7')
  assert.equal(res.headers.get('ratelimit-reset'), '8')
})

test('answers 429 with Retry-After in seconds once the tenant is over its limit', () => {
  const limiter = new RateLimiter(() => 0)
  for (let i = 0; i < 7; i++) send(limiter, request(acme, 'GET /v1/search'))
  const { res, passed } = send(limiter, request(acme, 'GET /v1/search'))
  assert.equal(passed, false)
  assert.equal(res.statusCode, 429)
  assert.equal(res.headers.get('retry-after'), '8')
  assert.equal(res.headers.get('ratelimit-reset'), '56')
  assert.deepEqual(JSON.parse(res.body), {
    error: 'rate_limited',
    route: 'GET /v1/search',
    retryAfterMs: 8000,
  })
})

test('limits each route separately', () => {
  const limiter = new RateLimiter(() => 0)
  for (let i = 0; i < 8; i++) send(limiter, request(acme, 'GET /v1/search'))
  const { res, passed } = send(limiter, request(acme, 'POST /v1/bookings'))
  assert.equal(passed, true)
  assert.equal(res.headers.get('ratelimit-remaining'), '14')
})
