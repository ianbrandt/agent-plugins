import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RateLimiter } from '../src/limiter.ts'
import type { Tenant } from '../src/tenants.ts'

const acme: Tenant = { id: 'acme', name: 'Acme Travel', region: 'us', plan: 'free' }
const globex: Tenant = { id: 'globex', name: 'Globex Holidays', region: 'us', plan: 'partner' }

function manualClock() {
  let now = 0
  return { now: () => now, advance: (ms: number) => void (now += ms) }
}

test('allows a burst up to the plan capacity', () => {
  const limiter = new RateLimiter(manualClock().now)
  for (let i = 0; i < 30; i++) assert.equal(limiter.check(acme).allowed, true)
  assert.deepEqual(limiter.check(acme), { allowed: false, remaining: 0, retryAfterMs: 2000 })
})

test('allows the next request once the bucket has refilled', () => {
  const clock = manualClock()
  const limiter = new RateLimiter(clock.now)
  for (let i = 0; i < 30; i++) limiter.check(acme)
  clock.advance(2000)
  assert.deepEqual(limiter.check(acme), { allowed: true, remaining: 0, retryAfterMs: 0 })
})

test('keeps a bucket for each tenant', () => {
  const limiter = new RateLimiter(manualClock().now)
  for (let i = 0; i < 30; i++) limiter.check(acme)
  assert.equal(limiter.check(acme).allowed, false)
  assert.equal(limiter.check(globex).remaining, 599)
})

test('gives a tenant on an unknown plan the free limits', () => {
  const limiter = new RateLimiter(manualClock().now)
  const initech: Tenant = { id: 'initech', name: 'Initech', region: 'us', plan: 'enterprise-2025' }
  assert.equal(limiter.check(initech).remaining, 29)
})

test('starts a full bucket after a reset', () => {
  const limiter = new RateLimiter(manualClock().now)
  for (let i = 0; i < 30; i++) limiter.check(acme)
  assert.equal(limiter.reset('acme'), true)
  assert.equal(limiter.check(acme).remaining, 29)
})

test('reports every bucket in a snapshot', () => {
  const clock = manualClock()
  const limiter = new RateLimiter(clock.now)
  limiter.check(acme, 10)
  limiter.check(globex)
  clock.advance(4000)
  assert.deepEqual(limiter.snapshot(), [
    { key: 'acme', tokens: 22, capacity: 30 },
    { key: 'globex', tokens: 600, capacity: 600 },
  ])
})
