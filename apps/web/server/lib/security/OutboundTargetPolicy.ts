import { lookup as dnsLookup } from 'node:dns'
import { lookup as resolveAll } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import type { LookupFunction } from 'node:net'
import { DomainError } from '../core/errors'

/** A host and port the server connects to on behalf of an organization. */
export interface OutboundTarget {
  host: string
  port: number
}

export interface OutboundPolicyOptions {
  /** Lets organizations reach loopback, private and link-local addresses (development only). */
  allowPrivateNetworks: boolean
  /**
   * Targets the instance operator configured or allowed (`host` or `host:port`):
   * never checked, e.g. the instance SMTP relay and S3 endpoint on a private network.
   */
  allowedTargets: readonly string[]
}

/** What resolving a target found. */
export type TargetCheck = 'allowed' | 'blocked' | 'unresolved'

/** An organization-configured target resolves to an internal address. */
export class BlockedTargetError extends DomainError {
  constructor(host: string) {
    super(
      `${host} points to a private or internal network address, which is not allowed.`,
      422,
      'blocked_target'
    )
  }
}

/** Loopback, private, link-local, CGNAT, multicast, reserved and unspecified ranges. */
function internalRanges(): BlockList {
  const list = new BlockList()

  const ipv4: [string, number][] = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4]
  ]

  const ipv6: [string, number][] = [
    // Unspecified, loopback and the deprecated IPv4-compatible block.
    ['::', 96],
    ['64:ff9b::', 96],
    ['100::', 64],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8]
  ]

  for (const [network, prefix] of ipv4) list.addSubnet(network, prefix, 'ipv4')

  for (const [network, prefix] of ipv6) list.addSubnet(network, prefix, 'ipv6')

  return list
}

/**
 * Where organization-configured connections (webhook URLs, SMTP hosts, S3
 * endpoints) may go: anywhere public, never the instance's own network
 * (loopback, private ranges, link-local metadata endpoints), unless the target
 * is one the operator configured or private networks are allowed. Checks every
 * resolved address, and `lookupFor` re-checks the addresses a connection
 * actually uses, so DNS rebinding cannot swap in an internal address later.
 */
export class OutboundTargetPolicy {
  private static readonly internal = internalRanges()
  private readonly allowed: ReadonlySet<string>

  constructor(private readonly options: OutboundPolicyOptions) {
    this.allowed = new Set(options.allowedTargets.map((entry) => entry.trim().toLowerCase()))
  }

  /** The host and port of an http(s) URL. */
  static targetOf(url: URL): OutboundTarget {
    const defaultPort = url.protocol === 'https:' ? 443 : url.protocol === 'http:' ? 80 : 0

    return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port) || defaultPort }
  }

  static isInternalAddress(address: string): boolean {
    const family = isIP(address)

    if (family === 0) return true

    return OutboundTargetPolicy.internal.check(address, family === 4 ? 'ipv4' : 'ipv6')
  }

  /** Whether the target skips the checks (private networks allowed, or operator-configured). */
  isTrusted(target: OutboundTarget): boolean {
    const host = target.host.toLowerCase()

    return (
      this.options.allowPrivateNetworks ||
      this.allowed.has(host) ||
      this.allowed.has(`${host}:${target.port}`)
    )
  }

  /** Resolves the target and checks every address it resolves to. */
  async check(target: OutboundTarget): Promise<TargetCheck> {
    if (this.isTrusted(target)) return 'allowed'

    if (isIP(target.host))
      return OutboundTargetPolicy.isInternalAddress(target.host) ? 'blocked' : 'allowed'

    try {
      const addresses = await resolveAll(target.host, { all: true })

      if (!addresses.length) return 'unresolved'

      return addresses.some((entry) => OutboundTargetPolicy.isInternalAddress(entry.address))
        ? 'blocked'
        : 'allowed'
    } catch {
      return 'unresolved'
    }
  }

  /** Throws BlockedTargetError when the target resolves to an internal address. */
  async assertAllowed(target: OutboundTarget): Promise<void> {
    if ((await this.check(target)) === 'blocked') throw new BlockedTargetError(target.host)
  }

  /**
   * A `lookup` for sockets to `target` (http.request, http.Agent) that refuses
   * internal addresses at connection time. IP literals never go through a lookup:
   * check them with `assertAllowed` first.
   */
  lookupFor(target: OutboundTarget): LookupFunction {
    if (this.isTrusted(target)) return dnsLookup

    return (hostname, options, callback) => {
      dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
        if (error) {
          callback(error, '')

          return
        }

        const [first] = addresses

        if (
          !first ||
          addresses.some((entry) => OutboundTargetPolicy.isInternalAddress(entry.address))
        ) {
          callback(new BlockedTargetError(hostname), '')

          return
        }

        if (options.all) callback(null, addresses)
        else callback(null, first.address, first.family)
      })
    }
  }
}
