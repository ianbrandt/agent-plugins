import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bucketKey, parseBucketKey } from '../src/keys.ts'

test('keys a bucket by tenant and route', () => {
  assert.equal(bucketKey('acme', 'POST /v1/bookings'), 'acme:POST /v1/bookings')
})

test('parses a key back into its tenant and route', () => {
  assert.deepEqual(parseBucketKey('acme:POST /v1/bookings'), {
    tenantId: 'acme',
    route: 'POST /v1/bookings',
  })
})

test('keeps the parameters of a route pattern when parsing', () => {
  const key = bucketKey('globex', 'DELETE /v1/bookings/:id')
  assert.deepEqual(parseBucketKey(key), { tenantId: 'globex', route: 'DELETE /v1/bookings/:id' })
})
