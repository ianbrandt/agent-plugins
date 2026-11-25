import { TokenBucket } from './bucket.ts'
import { plans, policyFor } from './policy.ts'
import type { Tenant } from './tenants.ts'

export interface Decision {
  allowed: boolean
  /** Whole requests left in the bucket. */
  remaining: number
  /** Milliseconds until the request would be allowed, or 0 when it was. */
  retryAfterMs: number
}

export interface BucketState {
  key: string
  tokens: number
  capacity: number
}

/** Rate-limits API requests with one token bucket per tenant. */
export class RateLimiter {
  private readonly buckets = new Map<string, TokenBucket>()
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  check(tenant: Tenant, cost = 1): Decision {
    const policy = policyFor(tenant.plan) ?? plans.free
    const now = this.now()
    let bucket = this.buckets.get(tenant.id)
    if (!bucket) {
      bucket = new TokenBucket(policy.capacity, policy.refillPerSec, now)
      this.buckets.set(tenant.id, bucket)
    }
    const result = bucket.take(now, cost)
    return {
      allowed: result.ok,
      remaining: Math.floor(result.tokens),
      retryAfterMs: Math.ceil(result.wait * 1000),
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
