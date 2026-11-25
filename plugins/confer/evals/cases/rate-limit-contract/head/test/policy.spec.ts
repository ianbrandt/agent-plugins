import assert from 'node:assert/strict'
import { test } from 'node:test'
import { policyFor } from '../src/policy.ts'

test('gives an ordinary route the full plan', () => {
  assert.deepEqual(policyFor('standard', 'GET /v1/bookings/:id'), { capacity: 120, refillPerSec: 2 })
})

test('gives search and quotes a quarter of the plan', () => {
  assert.deepEqual(policyFor('partner', 'GET /v1/search'), { capacity: 150, refillPerSec: 2.5 })
  assert.deepEqual(policyFor('partner', 'POST /v1/quotes'), { capacity: 150, refillPerSec: 2.5 })
})

test('gives new bookings half of the plan', () => {
  assert.deepEqual(policyFor('free', 'POST /v1/bookings'), { capacity: 15, refillPerSec: 0.25 })
})

test('rounds a share of the burst down to whole requests', () => {
  assert.deepEqual(policyFor('free', 'GET /v1/search'), { capacity: 7, refillPerSec: 0.125 })
})

test('gives an unknown plan the free limits', () => {
  assert.deepEqual(policyFor('enterprise-2025', 'GET /v1/bookings/:id'), { capacity: 30, refillPerSec: 0.5 })
  assert.deepEqual(policyFor('toString', 'GET /v1/bookings/:id'), { capacity: 30, refillPerSec: 0.5 })
})

test('has no policy for the status and limits routes', () => {
  assert.equal(policyFor('free', 'GET /v1/status'), undefined)
  assert.equal(policyFor('partner', 'GET /v1/limits'), undefined)
})
