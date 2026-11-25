import { parseBucketKey } from './keys.ts'
import type { RateLimiter } from './limiter.ts'
import type { Tenant } from './tenants.ts'

export interface RouteUsage {
  route: string
  remaining: number
  capacity: number
}

export interface TenantUsage {
  tenantId: string
  routes: RouteUsage[]
}

/** Usage of every bucket the limiter holds, grouped by tenant, for the operations dashboard. */
export function usageReport(limiter: RateLimiter): TenantUsage[] {
  const byTenant = new Map<string, RouteUsage[]>()
  for (const { key, tokens, capacity } of limiter.snapshot()) {
    const { tenantId, route } = parseBucketKey(key)
    const routes = byTenant.get(tenantId) ?? []
    routes.push({ route, remaining: Math.floor(tokens), capacity })
    byTenant.set(tenantId, routes)
  }
  return [...byTenant]
    .map(([tenantId, routes]) => ({
      tenantId,
      routes: routes.sort((a, b) => a.route.localeCompare(b.route)),
    }))
    .sort((a, b) => a.tenantId.localeCompare(b.tenantId))
}

/** The body of `GET /v1/limits`: the calling tenant's usage on each route it has called. */
export function limitsFor(limiter: RateLimiter, tenant: Tenant): RouteUsage[] {
  return usageReport(limiter).find((usage) => usage.tenantId === tenant.id)?.routes ?? []
}
