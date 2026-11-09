import type { DnsCheckStatus, DomainCheckResult } from '../../../shared/schemas/domains'
import { DnsRecordPlan } from './DnsRecordPlan'
import type { DnsPlanInput } from './DnsRecordPlan'
import { DkimCheck, DmarcCheck, MailFromMxCheck, SpfCheck } from './dns/checks'
import type { DomainCheck } from './dns/checks'
import { NodeDnsResolver } from './dns/DnsResolver'
import type { DnsResolver } from './dns/DnsResolver'

/**
 * Provider-agnostic deliverability checks: runs every DomainCheck against
 * live DNS and summarises the result. Checks are pluggable (strategy list).
 */
export class DnsChecker {
  constructor(
    private readonly dns: DnsResolver = new NodeDnsResolver(),
    private readonly checks: DomainCheck[] = [
      new SpfCheck(),
      new DkimCheck(),
      new MailFromMxCheck(),
      new DmarcCheck()
    ]
  ) {}

  async check(input: DnsPlanInput): Promise<DomainCheckResult> {
    const plan = new DnsRecordPlan(input)

    const results = (
      await Promise.all(
        this.checks.map((check) => check.run({ plan, dns: this.dns, ses: input.ses }))
      )
    ).flat()

    const summary: Record<DnsCheckStatus, number> = { pass: 0, warn: 0, fail: 0 }

    for (const result of results) summary[result.status]++

    const dmarc = results.find((r) => r.kind === 'dmarc')?.found[0]

    return {
      domain: input.domain,
      checkedAt: new Date().toISOString(),
      ses: input.ses,
      dmarcPolicy: dmarc ? DmarcCheck.parse(dmarc).policy : null,
      checks: results,
      summary
    }
  }
}
