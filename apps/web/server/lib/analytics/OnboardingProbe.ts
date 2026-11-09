import { sql } from 'drizzle-orm'
import type { Database } from '../../db/client'
import {
  broadcasts,
  contacts,
  emailEvents,
  lists,
  messages,
  settings,
  templates
} from '../../db/schema'
import type { OnboardingStatus } from '../../../shared/types/analytics'
import type { TenantScope } from '../core/TenantScope'

type ProbeRow = {
  sending_saved: boolean
  provider: string | null
  has_sent: boolean
  has_delivery: boolean
  has_list: boolean
  has_contacts: boolean
  has_template: boolean
  has_broadcast: boolean
}

/**
 * Checks one organization's first-run steps against its own data in a single
 * round trip. A sending domain counts as verified once the provider confirmed a
 * delivery (SES), or once an email went out through SMTP (no domain step in mlist).
 */
export class OnboardingProbe {
  constructor(
    private readonly scope: TenantScope,
    private readonly db: Database
  ) {}

  async status(): Promise<OnboardingStatus> {
    const own = this.scope
    const sending = sql`${own.eq(settings.organizationId)} and ${settings.key} = 'sending'`

    const result = await this.db.execute<ProbeRow>(sql`
      select
        exists(select 1 from ${settings} where ${sending}) as sending_saved,
        (select ${settings.value}->>'provider' from ${settings} where ${sending}) as provider,
        exists(
          select 1 from ${messages}
          where ${own.eq(messages.organizationId)} and ${messages.sentAt} is not null
        ) as has_sent,
        exists(
          select 1 from ${emailEvents}
          where ${own.eq(emailEvents.organizationId)} and ${emailEvents.type} = 'delivery'
        ) as has_delivery,
        exists(select 1 from ${lists} where ${own.eq(lists.organizationId)}) as has_list,
        exists(select 1 from ${contacts} where ${own.eq(contacts.organizationId)}) as has_contacts,
        exists(select 1 from ${templates} where ${own.eq(templates.organizationId)}) as has_template,
        exists(
          select 1 from ${broadcasts}
          where ${own.eq(broadcasts.organizationId)} and ${broadcasts.status} = 'sent'
        ) as has_broadcast
    `)

    const row = result.rows[0]

    if (!row)
      return {
        hasSent: false,
        steps: {
          sending: false,
          domain: false,
          list: false,
          contacts: false,
          template: false,
          broadcast: false
        }
      }
    const provider = row.provider ?? 'smtp'

    return {
      hasSent: row.has_sent,
      steps: {
        sending: row.sending_saved || row.has_sent,
        domain: row.has_delivery || (provider === 'smtp' && row.has_sent),
        list: row.has_list,
        contacts: row.has_contacts,
        template: row.has_template,
        broadcast: row.has_broadcast
      }
    }
  }
}
