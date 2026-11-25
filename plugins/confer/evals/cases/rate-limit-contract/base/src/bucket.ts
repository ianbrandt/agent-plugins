/** The outcome of taking tokens from a bucket. */
export interface TakeResult {
  ok: boolean
  /** Tokens left in the bucket afterward. */
  tokens: number
  /** Seconds until the bucket holds enough tokens, or 0 when the take succeeded. */
  wait: number
}

/**
 * A token bucket that starts full and refills continuously. Times are milliseconds from the
 * limiter's clock, and rates are per second.
 */
export class TokenBucket {
  readonly capacity: number
  readonly refillPerSec: number
  private tokens: number
  private updatedAt: number

  constructor(capacity: number, refillPerSec: number, now: number) {
    this.capacity = capacity
    this.refillPerSec = refillPerSec
    this.tokens = capacity
    this.updatedAt = now
  }

  /** Takes `cost` tokens if the bucket holds that many, and otherwise leaves it as it is. */
  take(now: number, cost = 1): TakeResult {
    this.refill(now)
    if (this.tokens >= cost) {
      this.tokens -= cost
      return { ok: true, tokens: this.tokens, wait: 0 }
    }
    return { ok: false, tokens: this.tokens, wait: (cost - this.tokens) / this.refillPerSec }
  }

  /** The tokens in the bucket at `now`. */
  peek(now: number): number {
    this.refill(now)
    return this.tokens
  }

  private refill(now: number): void {
    const elapsed = Math.max(0, now - this.updatedAt) / 1000
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec)
    this.updatedAt = now
  }
}
