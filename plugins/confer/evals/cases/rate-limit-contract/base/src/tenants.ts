export type Region = 'us' | 'eu' | 'ap'

export interface Tenant {
  id: string
  name: string
  region: Region
  /** The billing plan. Billing can add a plan before the gateway knows its limits. */
  plan: string
}

/**
 * Builds a tenant's ID from its region and slug. Tenants from before regional hosting are all in
 * `us` and keep their bare slug, which their API keys and invoices already use.
 */
export function tenantId(region: Region, slug: string): string {
  return region === 'us' ? slug : `${region}:${slug}`
}

/** Tenants by ID and by API key. */
export class TenantDirectory {
  private readonly byId = new Map<string, Tenant>()
  private readonly byApiKey = new Map<string, Tenant>()

  add(tenant: Tenant, apiKeys: string[]): void {
    this.byId.set(tenant.id, tenant)
    for (const key of apiKeys) this.byApiKey.set(key, tenant)
  }

  get(id: string): Tenant | undefined {
    return this.byId.get(id)
  }

  forApiKey(apiKey: string): Tenant | undefined {
    return this.byApiKey.get(apiKey)
  }
}
