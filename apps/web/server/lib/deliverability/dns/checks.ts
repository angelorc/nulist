import type {
  DmarcPolicy,
  DnsCheck,
  DnsCheckKind,
  DnsCheckStatus,
  DnsRecord
} from '../../../../shared/schemas/domains'
import { SES_SPF_INCLUDE } from '../DnsRecordPlan'
import type { DnsRecordPlan } from '../DnsRecordPlan'
import { DnsLookupError, normalizeHostname } from './DnsResolver'
import type { DnsResolver } from './DnsResolver'

export interface CheckContext {
  plan: DnsRecordPlan
  dns: DnsResolver
  /** Mail goes out through Amazon SES. */
  ses: boolean
}

/** One family of DNS checks (SPF, DKIM, DMARC, MX). Each produces one or more results. */
export interface DomainCheck {
  readonly kind: DnsCheckKind
  run(ctx: CheckContext): Promise<DnsCheck[]>
}

/** Template base: converts lookup failures into a `warn` result instead of failing the whole report. */
abstract class BaseCheck implements DomainCheck {
  abstract readonly kind: DnsCheckKind

  abstract run(ctx: CheckContext): Promise<DnsCheck[]>

  protected result(
    id: string,
    label: string,
    status: DnsCheckStatus,
    record: DnsRecord,
    found: string[],
    help: string
  ): DnsCheck {
    return { id, kind: this.kind, label, status, record, found, help }
  }

  protected async guard(
    id: string,
    label: string,
    record: DnsRecord,
    run: () => Promise<DnsCheck>
  ): Promise<DnsCheck> {
    try {
      return await run()
    } catch (error) {
      if (!(error instanceof DnsLookupError)) throw error

      return this.result(
        id,
        label,
        'warn',
        record,
        [],
        `${error.message}. DNS may be slow or unreachable; try again in a moment.`
      )
    }
  }
}

// ---------------------------------------------------------------------------
// SPF
// ---------------------------------------------------------------------------
export class SpfCheck extends BaseCheck {
  readonly kind = 'spf' as const

  async run({ plan, dns, ses }: CheckContext): Promise<DnsCheck[]> {
    const record = plan.spf()
    const target = record.name
    const label = plan.mailFromDomain ? 'SPF (MAIL FROM)' : 'SPF'

    return [
      await this.guard('spf', label, record, async () => {
        const found = (await dns.txt(target)).filter((value) => /^v=spf1(\s|$)/i.test(value.trim()))
        const fail = (help: string) => this.result('spf', label, 'fail', record, found, help)
        const warn = (help: string) => this.result('spf', label, 'warn', record, found, help)
        const pass = (help: string) => this.result('spf', label, 'pass', record, found, help)

        if (!found.length) {
          if (ses && !plan.mailFromDomain) {
            return warn(
              `No SPF record on ${target}. SES sends with its own MAIL FROM domain, so SPF still passes but is not aligned with your domain. Set a custom MAIL FROM domain for full alignment.`
            )
          }

          return fail(
            `No SPF record on ${target}. Add the TXT record so receivers know which servers may send for this domain.`
          )
        }

        if (found.length > 1) {
          return fail(
            `Found ${found.length} SPF records on ${target}. Merge them into a single TXT record: more than one makes SPF fail for every message.`
          )
        }

        const spf = (found[0] ?? '').toLowerCase()

        if (/(^|\s)\+?all(\s|$)/.test(spf)) {
          return warn(
            'The record ends with +all, which lets any server send as your domain. Use ~all (soft fail) or -all (hard fail).'
          )
        }

        const includesSes = spf.includes(`include:${SES_SPF_INCLUDE}`)

        if (ses && plan.mailFromDomain && !includesSes) {
          return fail(
            `The SPF record on ${target} does not authorize Amazon SES. Add include:${SES_SPF_INCLUDE} before the all mechanism.`
          )
        }

        if (ses && !plan.mailFromDomain) {
          return pass(
            `SPF record found on ${target}. SES uses its own MAIL FROM domain, so this record covers your other senders; set a custom MAIL FROM domain for aligned SPF.`
          )
        }

        if (!/(^|\s)[~-]all(\s|$)/.test(spf) && !spf.includes('redirect=')) {
          return warn(
            'The record has no ~all or -all mechanism, so unlisted servers are treated as neutral. End it with ~all.'
          )
        }

        return pass(`SPF record found on ${target}.`)
      })
    ]
  }
}

// ---------------------------------------------------------------------------
// DKIM
// ---------------------------------------------------------------------------
/** Selectors used by common providers, probed when no SES tokens are known. */
const COMMON_DKIM_SELECTORS = [
  'default',
  'google',
  'selector1',
  'selector2',
  'k1',
  'k2',
  's1',
  's2',
  'dkim',
  'mail',
  'smtp',
  'mandrill',
  'pm',
  'mxvault',
  'zoho'
]

export class DkimCheck extends BaseCheck {
  readonly kind = 'dkim' as const

  async run(ctx: CheckContext): Promise<DnsCheck[]> {
    return ctx.plan.dkimTokens.length ? this.checkTokens(ctx) : [await this.probeSelectors(ctx)]
  }

  /** SES Easy DKIM: every token must be a CNAME to `<token>.dkim.amazonses.com`. */
  private async checkTokens({ plan, dns }: CheckContext): Promise<DnsCheck[]> {
    const records = plan.dkim()

    return Promise.all(
      records.map((record, index) => {
        const id = `dkim-${index + 1}`
        const label = `DKIM ${index + 1} of ${records.length}`

        return this.guard(id, label, record, async () => {
          const found = await dns.cname(record.name)
          const expected = normalizeHostname(record.value)

          if (found.includes(expected))
            return this.result(id, label, 'pass', record, found, 'CNAME points to Amazon SES.')

          if (found.length) {
            return this.result(
              id,
              label,
              'fail',
              record,
              found,
              `The CNAME points to ${found[0]} instead of ${expected}. Update the record value.`
            )
          }

          return this.result(
            id,
            label,
            'fail',
            record,
            found,
            'CNAME not found. Add it at your DNS provider; new records can take a few minutes up to 72 hours to propagate.'
          )
        })
      })
    )
  }

  /** Provider-agnostic: look for a DKIM key at well-known selectors. */
  private async probeSelectors({ plan, dns }: CheckContext): Promise<DnsCheck> {
    const record = plan.genericDkim()
    const label = 'DKIM'

    return this.guard('dkim', label, record, async () => {
      const hits = await Promise.all(
        COMMON_DKIM_SELECTORS.map(async (selector) => {
          try {
            const values = await dns.txt(`${selector}._domainkey.${plan.domain}`)

            return values.some((v) => /(^|;)\s*(v=DKIM1|p=)/i.test(v)) ? selector : null
          } catch {
            return null
          }
        })
      )

      const selectors = hits.filter((s): s is string => !!s)

      if (selectors.length) {
        const found = selectors.map((s) => `${s}._domainkey.${plan.domain}`)

        return this.result(
          'dkim',
          label,
          'pass',
          { ...record, name: found[0] ?? record.name },
          found,
          `DKIM key found for selector${selectors.length > 1 ? 's' : ''} ${selectors.join(', ')}.`
        )
      }

      return this.result(
        'dkim',
        label,
        'warn',
        record,
        [],
        "No DKIM key found at common selectors. Selectors are provider-specific: check your email provider's setup guide and publish the key it gives you."
      )
    })
  }
}

// ---------------------------------------------------------------------------
// DMARC
// ---------------------------------------------------------------------------
export interface ParsedDmarc {
  policy: DmarcPolicy | null
  subdomainPolicy: DmarcPolicy | null
  rua: string | null
  pct: number | null
}

const DMARC_POLICIES: DmarcPolicy[] = ['none', 'quarantine', 'reject']

/** A DMARC `p=`/`sp=` value, or null when missing or unknown. */
function dmarcPolicy(value?: string): DmarcPolicy | null {
  return DMARC_POLICIES.find((p) => p === value?.trim().toLowerCase()) ?? null
}

export class DmarcCheck extends BaseCheck {
  readonly kind = 'dmarc' as const

  static parse(record: string): ParsedDmarc {
    const tags = new Map<string, string>()

    for (const part of record.split(';')) {
      const [key, ...rest] = part.split('=')

      if (key && rest.length) tags.set(key.trim().toLowerCase(), rest.join('=').trim())
    }

    const pct = tags.get('pct')

    return {
      policy: dmarcPolicy(tags.get('p')),
      subdomainPolicy: dmarcPolicy(tags.get('sp')),
      rua: tags.get('rua') ?? null,
      pct: pct !== undefined && !Number.isNaN(Number(pct)) ? Number(pct) : null
    }
  }

  static isDmarc(value: string) {
    return /^v=DMARC1(\s*;|$)/i.test(value.trim())
  }

  /** Naive organizational domain (last two labels) used as a fallback for subdomains. */
  private static parentDomain(domain: string): string | null {
    const labels = domain.split('.')

    return labels.length > 2 ? labels.slice(-2).join('.') : null
  }

  async run({ plan, dns }: CheckContext): Promise<DnsCheck[]> {
    const record = plan.dmarc()
    const label = 'DMARC'

    return [
      await this.guard('dmarc', label, record, async () => {
        let found = (await dns.txt(record.name)).filter(DmarcCheck.isDmarc)
        let inherited: string | null = null
        const parent = DmarcCheck.parentDomain(plan.domain)

        if (!found.length && parent) {
          found = (await dns.txt(`_dmarc.${parent}`)).filter(DmarcCheck.isDmarc)

          if (found.length) inherited = parent
        }

        const result = (status: DnsCheckStatus, help: string) =>
          this.result('dmarc', label, status, record, found, help)

        if (!found.length) {
          return result(
            'fail',
            'No DMARC record. Gmail and Yahoo require DMARC for bulk senders. Start with p=none to monitor, then tighten the policy.'
          )
        }

        if (found.length > 1) {
          return result(
            'fail',
            `Found ${found.length} DMARC records. Keep exactly one; receivers ignore DMARC when there are several.`
          )
        }

        const parsed = DmarcCheck.parse(found[0] ?? '')
        const policy = inherited ? (parsed.subdomainPolicy ?? parsed.policy) : parsed.policy
        const source = inherited ? ` (inherited from ${inherited})` : ''
        const reports = parsed.rua ? '' : ' Add rua=mailto:… to receive aggregate reports.'

        switch (policy) {
          case 'none':
            return result(
              'warn',
              `Policy is p=none${source}: monitoring only. Once reports show your mail passes, move to p=quarantine, then p=reject.${reports}`
            )
          case 'quarantine':
            return result(
              'pass',
              `Policy is p=quarantine${source}: failing mail goes to spam. Consider p=reject once you are confident.${reports}`
            )
          case 'reject':
            return result(
              'pass',
              `Policy is p=reject${source}: failing mail is rejected. Strongest protection.${reports}`
            )
          default:
            return result(
              'fail',
              'The DMARC record has no valid p= tag. Use p=none, p=quarantine or p=reject.'
            )
        }
      })
    ]
  }
}

// ---------------------------------------------------------------------------
// MX for a custom MAIL FROM domain
// ---------------------------------------------------------------------------
export class MailFromMxCheck extends BaseCheck {
  readonly kind = 'mx' as const

  async run({ plan, dns }: CheckContext): Promise<DnsCheck[]> {
    const record = plan.mailFromMx()

    if (!record || !plan.mailFromDomain) return []
    const label = 'MX (MAIL FROM)'

    return [
      await this.guard('mx', label, record, async () => {
        const records = await dns.mx(record.name)
        const found = records.map((mx) => `${mx.priority} ${mx.exchange}`)

        if (record.placeholder) {
          return records.length
            ? this.result(
                'mx',
                label,
                'pass',
                record,
                found,
                'MX record found for the MAIL FROM domain.'
              )
            : this.result(
                'mx',
                label,
                'warn',
                record,
                found,
                'No MX record on the MAIL FROM domain, so bounces cannot be returned. Add the MX host from your provider.'
              )
        }

        const expected = normalizeHostname(record.value)

        if (records.some((mx) => mx.exchange === expected)) {
          return this.result(
            'mx',
            label,
            'pass',
            record,
            found,
            'Bounces and complaints are routed back to Amazon SES.'
          )
        }

        if (records.length) {
          return this.result(
            'mx',
            label,
            'fail',
            record,
            found,
            `The MX record points to ${records[0]?.exchange}. It must point to ${expected} for SES to accept the MAIL FROM domain.`
          )
        }

        return this.result(
          'mx',
          label,
          'fail',
          record,
          found,
          `No MX record on ${record.name}. Add it so SES can verify the MAIL FROM domain.`
        )
      })
    ]
  }
}
