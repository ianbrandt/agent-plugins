import { TokenBucket } from './bucket.ts'
import { bucketKey } from './keys.ts'
import { plans, policyFor } from './policy.ts'
import type { Tenant } from './tenants.ts'

export interface Decision {
  allowed: boolean
  /** Requests the bucket holds when full. */
  limit: number
  /** Whole requests left in the bucket. */
  remaining: number
  /** Milliseconds until the request would be allowed, or 0 when it was. */
  retryAfterMs: number
  /** Seconds until the bucket is full again. */
  reset: number
}

export interface BucketState {
  key: string
  tokens: number
  capacity: number
}

/** Rate-limits API requests with one token bucket per tenant and route. */
export class RateLimiter {
  private readonly buckets = new Map<string, TokenBucket>()
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  /** Drops the buckets that have refilled completely, and returns how many it dropped. */
  prune(): number {
    const now = this.now()
    let dropped = 0
    for (const [key, bucket] of this.buckets) {
      if (bucket.secondsToFull(now) === 0) {
        this.buckets.delete(key)
        dropped++
      }
    }
    return dropped
  }

  check(tenant: Tenant, route: string, cost = 1): Decision {
    const policy = policyFor(tenant.plan, route) ?? plans.free
    const key = bucketKey(tenant.id, route)
    const now = this.now()
    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = new TokenBucket(policy.capacity, policy.refillPerSec, now)
      this.buckets.set(key, bucket)
    }
    const result = bucket.take(now, cost)
    return {
      allowed: result.ok,
      limit: bucket.capacity,
      remaining: Math.floor(result.tokens),
      retryAfterMs: Math.ceil(result.wait * 1000),
      reset: Math.ceil(bucket.secondsToFull(now)),
    }
  }

  /** Forgets the bucket under `key`, so the next request starts a full one. */
  reset(key: string): boolean {
    return this.buckets.delete(key)
  }

  /** The state of every bucket as of now. */
  snapshot(): BucketState[] {
    const now = this.now()
    return [...this.buckets].map(([key, bucket]) => ({
      key,
      tokens: bucket.peek(now),
      capacity: bucket.capacity,
    }))
  }
}
