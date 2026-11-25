import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bucketKey } from '../src/keys.ts'
import { RateLimiter } from '../src/limiter.ts'
import type { Tenant } from '../src/tenants.ts'

const acme: Tenant = { id: 'acme', name: 'Acme Travel', region: 'us', plan: 'free' }
const globex: Tenant = { id: 'globex', name: 'Globex Holidays', region: 'us', plan: 'partner' }

const booking = 'GET /v1/bookings/:id'
const search = 'GET /v1/search'

function manualClock() {
  let now = 0
  return { now: () => now, advance: (ms: number) => void (now += ms) }
}

test('allows a burst up to the plan capacity', () => {
  const limiter = new RateLimiter(manualClock().now)
  for (let i = 0; i < 30; i++) assert.equal(limiter.check(acme, booking).allowed, true)
  assert.deepEqual(limiter.check(acme, booking), {
    allowed: false,
    limit: 30,
    remaining: 0,
    retryAfterMs: 2000,
    reset: 60,
  })
})

test('allows the next request once the bucket has refilled', () => {
  const clock = manualClock()
  const limiter = new RateLimiter(clock.now)
  for (let i = 0; i < 30; i++) limiter.check(acme, booking)
  clock.advance(2000)
  assert.deepEqual(limiter.check(acme, booking), {
    allowed: true,
    limit: 30,
    remaining: 0,
    retryAfterMs: 0,
    reset: 60,
  })
})

test('limits search to its share of the plan', () => {
  const limiter = new RateLimiter(manualClock().now)
  for (let i = 0; i < 7; i++) assert.equal(limiter.check(acme, search).allowed, true)
  const refused = limiter.check(acme, search)
  assert.equal(refused.allowed, false)
  assert.equal(refused.limit, 7)
  assert.equal(refused.retryAfterMs, 8000)
})

test('keeps a bucket for each route', () => {
  const limiter = new RateLimiter(manualClock().now)
  for (let i = 0; i < 7; i++) limiter.check(acme, search)
  assert.equal(limiter.check(acme, search).allowed, false)
  assert.equal(limiter.check(acme, booking).remaining, 29)
})

test('keeps a bucket for each tenant', () => {
  const limiter = new RateLimiter(manualClock().now)
  for (let i = 0; i < 7; i++) limiter.check(acme, search)
  assert.equal(limiter.check(acme, search).allowed, false)
  assert.equal(limiter.check(globex, search).remaining, 149)
})

test('gives a tenant on an unknown plan the free limits', () => {
  const limiter = new RateLimiter(manualClock().now)
  const initech: Tenant = { id: 'initech', name: 'Initech', region: 'us', plan: 'enterprise-2025' }
  const decision = limiter.check(initech, booking)
  assert.equal(decision.limit, 30)
  assert.equal(decision.remaining, 29)
})

test('reports the seconds until the bucket is full again', () => {
  const clock = manualClock()
  const limiter = new RateLimiter(clock.now)
  assert.equal(limiter.check(globex, booking, 50).reset, 5)
  clock.advance(1500)
  assert.equal(limiter.check(globex, booking).reset, 4)
})

test('starts a full bucket after a reset', () => {
  const limiter = new RateLimiter(manualClock().now)
  for (let i = 0; i < 7; i++) limiter.check(acme, search)
  assert.equal(limiter.reset(bucketKey('acme', search)), true)
  assert.equal(limiter.check(acme, search).remaining, 6)
})

test('reports every bucket in a snapshot', () => {
  const clock = manualClock()
  const limiter = new RateLimiter(clock.now)
  limiter.check(acme, booking, 10)
  limiter.check(acme, search)
  limiter.check(globex, search)
  clock.advance(4000)
  assert.deepEqual(limiter.snapshot(), [
    { key: 'acme:GET /v1/bookings/:id', tokens: 22, capacity: 30 },
    { key: 'acme:GET /v1/search', tokens: 6.5, capacity: 7 },
    { key: 'globex:GET /v1/search', tokens: 150, capacity: 150 },
  ])
})

test('prunes only the buckets that have refilled completely', () => {
  const clock = manualClock()
  const limiter = new RateLimiter(clock.now)
  limiter.check(acme, booking)
  limiter.check(acme, search, 7)
  clock.advance(1000)
  assert.equal(limiter.prune(), 0)
  clock.advance(1000)
  assert.equal(limiter.prune(), 1)
  assert.deepEqual(
    limiter.snapshot().map((state) => state.key),
    ['acme:GET /v1/search'],
  )
})
