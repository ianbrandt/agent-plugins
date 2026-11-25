import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TokenBucket } from '../src/bucket.ts'

test('starts full', () => {
  const bucket = new TokenBucket(10, 1, 0)
  assert.equal(bucket.peek(0), 10)
})

test('refuses a take larger than the tokens it holds, and reports the wait in seconds', () => {
  const bucket = new TokenBucket(2, 0.5, 0)
  assert.deepEqual(bucket.take(0, 2), { ok: true, tokens: 0, wait: 0 })
  assert.deepEqual(bucket.take(0, 1), { ok: false, tokens: 0, wait: 2 })
})

test('refills at its rate per second', () => {
  const bucket = new TokenBucket(10, 2, 0)
  bucket.take(0, 10)
  assert.equal(bucket.peek(1500), 3)
})

test('never refills past its capacity', () => {
  const bucket = new TokenBucket(10, 2, 0)
  bucket.take(0, 4)
  assert.equal(bucket.peek(60_000), 10)
})

test('ignores a clock that goes backward', () => {
  const bucket = new TokenBucket(10, 1, 5000)
  bucket.take(5000, 5)
  assert.equal(bucket.peek(4000), 5)
})

test('reports the seconds until it is full', () => {
  const bucket = new TokenBucket(10, 2, 0)
  bucket.take(0, 5)
  assert.equal(bucket.secondsToFull(0), 2.5)
  assert.equal(bucket.secondsToFull(1000), 1.5)
  assert.equal(bucket.secondsToFull(10_000), 0)
})
