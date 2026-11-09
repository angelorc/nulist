import { BlockList, isIP } from 'node:net'

/**
 * Request header carrying the client address resolved by the server
 * (server/middleware/client-address.ts overwrites whatever a client sends).
 * Better Auth reads it for its rate limits and session records.
 */
export const CLIENT_IP_HEADER = 'x-nulist-client-ip'

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i

/** A bare IP (IPv4-mapped IPv6 as IPv4), or null when `value` is not an IP. */
function normalize(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  const address = IPV4_MAPPED.exec(trimmed)?.[1] ?? trimmed

  return isIP(address) ? address : null
}

/**
 * The client address of a request: the socket peer, unless that peer is a
 * trusted proxy, in which case X-Forwarded-For is walked from the right
 * (nearest hop first) up to the first address that is not a trusted proxy.
 * Without trusted proxies the header is ignored: any client can write it.
 */
export class ClientAddressResolver {
  private readonly proxies = new BlockList()
  private readonly hasProxies: boolean

  /** `trustedProxies`: IPs or CIDR ranges of the reverse proxies in front of nulist, or `loopback`. */
  constructor(trustedProxies: readonly string[]) {
    let added = 0

    for (const entry of trustedProxies.map((value) => value.trim().toLowerCase())) {
      if (entry === 'loopback') {
        this.proxies.addSubnet('127.0.0.0', 8, 'ipv4')
        this.proxies.addAddress('::1', 'ipv6')
        added++
        continue
      }

      const [network = '', prefix] = entry.split('/')
      const family = isIP(network)
      const bits = prefix === undefined ? null : Number(prefix)

      if (
        !family ||
        (bits !== null && (!Number.isInteger(bits) || bits < 0 || bits > (family === 4 ? 32 : 128)))
      ) {
        console.warn(`[client-address] ignoring trusted proxy "${entry}": not an IP or CIDR`)
        continue
      }

      const type = family === 4 ? 'ipv4' : 'ipv6'

      if (bits === null) this.proxies.addAddress(network, type)
      else this.proxies.addSubnet(network, bits, type)
      added++
    }

    this.hasProxies = added > 0
  }

  resolve(peer: string | undefined, forwardedFor: string | undefined): string | null {
    let address = normalize(peer)

    if (!address || !this.hasProxies) return address

    const hops = (forwardedFor ?? '').split(',').toReversed()

    for (const hop of hops) {
      if (!this.isProxy(address)) break
      const next = normalize(hop)

      if (!next) break
      address = next
    }

    return address
  }

  private isProxy(address: string): boolean {
    return this.proxies.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6')
  }
}
