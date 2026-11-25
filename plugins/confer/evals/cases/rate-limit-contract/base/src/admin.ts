import type { RateLimiter } from './limiter.ts'
import type { Tenant } from './tenants.ts'

export interface TenantUsage {
  tenantId: string
  remaining: number
  capacity: number
}

/** Usage of every bucket the limiter holds, for the operations dashboard. */
export function usageReport(limiter: RateLimiter): TenantUsage[] {
  return limiter
    .snapshot()
    .map(({ key, tokens, capacity }) => ({ tenantId: key, remaining: Math.floor(tokens), capacity }))
    .sort((a, b) => a.tenantId.localeCompare(b.tenantId))
}

/** The body of `GET /v1/limits`: the calling tenant's usage, or undefined before its first request. */
export function limitsFor(limiter: RateLimiter, tenant: Tenant): TenantUsage | undefined {
  return usageReport(limiter).find((usage) => usage.tenantId === tenant.id)
}
