import type { RateLimiter } from './limiter.ts'
import { plans } from './policy.ts'
import type { TenantDirectory } from './tenants.ts'

// Commands for the support console. Each returns the line the console prints.

export function resetQuota(limiter: RateLimiter, tenants: TenantDirectory, id: string): string {
  const tenant = tenants.get(id)
  if (!tenant) return `No tenant with ID ${id}`
  return limiter.reset(tenant.id)
    ? `Reset the rate limit for ${tenant.name}`
    : `${tenant.name} has not used its rate limit since the gateway started`
}

export function describePlan(tenants: TenantDirectory, id: string): string {
  const tenant = tenants.get(id)
  if (!tenant) return `No tenant with ID ${id}`
  const policy = Object.hasOwn(plans, tenant.plan) ? plans[tenant.plan] : plans.free
  return `${tenant.name} is on the ${tenant.plan} plan: bursts of ${policy.capacity}, then ${policy.refillPerSec} requests per second`
}
