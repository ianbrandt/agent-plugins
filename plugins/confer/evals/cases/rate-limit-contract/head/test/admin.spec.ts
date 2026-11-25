import assert from 'node:assert/strict'
import { test } from 'node:test'
import { limitsFor, usageReport } from '../src/admin.ts'
import { RateLimiter } from '../src/limiter.ts'
import type { Tenant } from '../src/tenants.ts'

const acme: Tenant = { id: 'acme', name: 'Acme Travel', region: 'us', plan: 'free' }
const globex: Tenant = { id: 'globex', name: 'Globex Holidays', region: 'us', plan: 'partner' }

function busyLimiter(): RateLimiter {
  const limiter = new RateLimiter(() => 0)
  limiter.check(globex, 'GET /v1/search', 50)
  limiter.check(acme, 'POST /v1/bookings', 3)
  limiter.check(acme, 'GET /v1/search')
  return limiter
}

test('groups usage by tenant, in order of tenant and route', () => {
  assert.deepEqual(usageReport(busyLimiter()), [
    {
      tenantId: 'acme',
      routes: [
        { route: 'GET /v1/search', remaining: 6, capacity: 7 },
        { route: 'POST /v1/bookings', remaining: 12, capacity: 15 },
      ],
    },
    {
      tenantId: 'globex',
      routes: [{ route: 'GET /v1/search', remaining: 100, capacity: 150 }],
    },
  ])
})

test('reports a tenant its own usage', () => {
  assert.deepEqual(limitsFor(busyLimiter(), globex), [
    { route: 'GET /v1/search', remaining: 100, capacity: 150 },
  ])
})

test('reports no usage for a tenant that has made no requests', () => {
  const initech: Tenant = { id: 'initech', name: 'Initech', region: 'us', plan: 'standard' }
  assert.deepEqual(limitsFor(busyLimiter(), initech), [])
})
