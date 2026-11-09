import type { Database } from '../../db/client'
import { organization } from '../../db/schema'
import type { PublicBrand } from '../../../shared/schemas/public'
import type { TenantScope } from '../core/TenantScope'
import type { SettingsService } from '../settings/SettingsService'

/**
 * Branding of one organization on recipient pages (confirm, preferences,
 * signup form): company details from Settings → General and the organization
 * logo. Embedded in every public payload instead of a context-free endpoint.
 */
export class PublicBrandReader {
  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database,
    private readonly settings: SettingsService
  ) {}

  async read(): Promise<PublicBrand> {
    const [general, [row]] = await Promise.all([
      this.settings.get('general'),
      this.db
        .select({ logo: organization.logo })
        .from(organization)
        .where(this.scope.eq(organization.id))
    ])

    return {
      appName: general.appName,
      companyName: general.companyName,
      companyAddress: general.companyAddress,
      logo: row?.logo || null
    }
  }
}
