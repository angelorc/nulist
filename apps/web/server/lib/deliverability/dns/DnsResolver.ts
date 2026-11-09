import { Resolver } from 'node:dns/promises'
import { z } from 'zod'

export interface MxRecord {
  priority: number
  exchange: string
}

/** Strategy for DNS lookups (Node resolver in the app, a fake in tests). Missing records resolve to `[]`. */
export interface DnsResolver {
  txt(name: string): Promise<string[]>
  cname(name: string): Promise<string[]>
  mx(name: string): Promise<MxRecord[]>
}

/** A lookup that failed for reasons other than "record does not exist" (timeouts, SERVFAIL…). */
export class DnsLookupError extends Error {
  constructor(
    readonly hostname: string,
    readonly code: string
  ) {
    super(`DNS lookup for ${hostname} failed (${code})`)
    this.name = 'DnsLookupError'
  }
}

/** Error codes that simply mean the record is not there. */
const MISSING_CODES = new Set(['ENODATA', 'ENOTFOUND', 'NXDOMAIN', 'ENONAME'])

/** The `code` of a node:dns failure (`EUNKNOWN` when it carries none). */
const dnsFailureSchema = z
  .object({ code: z.string().catch('EUNKNOWN') })
  .catch({ code: 'EUNKNOWN' })

/** Lower-cases and strips the trailing root dot so hostnames compare reliably. */
export function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, '')
}

/** node:dns based resolver with short timeouts, suitable for interactive checks. */
export class NodeDnsResolver implements DnsResolver {
  private readonly resolver: Resolver

  constructor(options: { timeoutMs?: number; tries?: number; servers?: string[] } = {}) {
    this.resolver = new Resolver({ timeout: options.timeoutMs ?? 4000, tries: options.tries ?? 2 })

    if (options.servers?.length) this.resolver.setServers(options.servers)
  }

  private async lookup<T>(hostname: string, run: () => Promise<T[]>): Promise<T[]> {
    try {
      return await run()
    } catch (cause) {
      const { code } = dnsFailureSchema.parse(cause)

      if (MISSING_CODES.has(code)) return []
      throw new DnsLookupError(hostname, code)
    }
  }

  async txt(name: string): Promise<string[]> {
    const chunks = await this.lookup(name, () => this.resolver.resolveTxt(name))

    // A TXT record may be split into 255-byte strings; receivers concatenate them.
    return chunks.map((parts) => parts.join(''))
  }

  async cname(name: string): Promise<string[]> {
    const values = await this.lookup(name, () => this.resolver.resolveCname(name))

    return values.map(normalizeHostname)
  }

  async mx(name: string): Promise<MxRecord[]> {
    const values = await this.lookup(name, () => this.resolver.resolveMx(name))

    return values
      .map((record) => ({
        priority: record.priority,
        exchange: normalizeHostname(record.exchange)
      }))
      .toSorted((a, b) => a.priority - b.priority)
  }
}
