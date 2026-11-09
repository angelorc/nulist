import { version } from '../package.json'
import { Environment } from './core/environment'
import { HttpClient } from './core/http-client'
import type { FetchFunction } from './core/http-client'
import { Broadcasts } from './resources/broadcasts'
import { Contacts } from './resources/contacts'
import { Batch, Emails } from './resources/emails'
import { Lists } from './resources/lists'
import { Templates } from './resources/templates'

const DEFAULT_USER_AGENT = `mlist-node:${version}`

/** A trailing `/api/v1` (and slashes) on the base URL is accepted. */
const API_SUFFIX = /(?:\/api\/v1)?\/*$/

export interface MlistOptions {
  /** Origin of your mlist instance, e.g. `https://mail.example.com`. Defaults to `MLIST_BASE_URL`. */
  baseUrl?: string
  /** Defaults to `MLIST_USER_AGENT`, then `mlist-node:<version>`. */
  userAgent?: string
  /** Custom fetch (proxies, instrumentation, tests). Defaults to the global `fetch`. */
  fetch?: FetchFunction
}

/** The origin of an mlist instance, without the `/api/v1` suffix. */
function normalizeBaseUrl(value: string): string {
  let url: URL

  try {
    url = new URL(value.trim())
  } catch {
    throw new Error(
      `Invalid base URL "${value}". Use the origin of your mlist instance, e.g. https://mail.example.com.`
    )
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error(`Invalid base URL "${value}": use http:// or https://.`)

  return `${url.origin}${url.pathname}`.replace(API_SUFFIX, '')
}

/** The global fetch, looked up at call time (polyfills installed later still apply). */
function globalFetch(): FetchFunction {
  if (!('fetch' in globalThis))
    throw new Error('No fetch implementation found. Use Node.js 20+ or pass `options.fetch`.')

  return (url, init) => globalThis.fetch(url, init)
}

/**
 * Client of the mlist REST API (`/api/v1`) of one organization: the API key
 * decides the organization. Every method resolves to `{ data, error, headers }`
 * and never throws or rejects (HTTP errors, network failures and aborts are
 * returned in `error`); the constructor throws on misconfiguration only.
 *
 * ```ts
 * const mlist = new Mlist('ml_...', { baseUrl: 'https://mail.example.com' })
 * const { data, error } = await mlist.emails.send({ to: 'ada@example.com', template: 'welcome' })
 * ```
 */
export class Mlist {
  /** Origin of the instance (without `/api/v1`). */
  readonly baseUrl: string
  readonly userAgent: string
  readonly emails: Emails
  /** Same as `emails.batch`. */
  readonly batch: Batch
  readonly contacts: Contacts
  readonly lists: Lists
  readonly broadcasts: Broadcasts
  readonly templates: Templates

  /** @param key API key (`ml_…`); defaults to `MLIST_API_KEY`. */
  constructor(key?: string, options: MlistOptions = {}) {
    const apiKey = key?.trim() || Environment.read('MLIST_API_KEY')

    if (!apiKey)
      throw new Error(
        'Missing API key. Pass it to the constructor `new Mlist("ml_123")` or set MLIST_API_KEY.'
      )

    const baseUrl = options.baseUrl ?? Environment.read('MLIST_BASE_URL')

    if (!baseUrl) {
      throw new Error(
        'Missing base URL. Pass `new Mlist("ml_123", { baseUrl: "https://mail.example.com" })` or set MLIST_BASE_URL.'
      )
    }

    this.baseUrl = normalizeBaseUrl(baseUrl)
    this.userAgent = options.userAgent ?? Environment.read('MLIST_USER_AGENT') ?? DEFAULT_USER_AGENT

    const transport = new HttpClient({
      apiUrl: `${this.baseUrl}/api/v1`,
      apiKey,
      userAgent: this.userAgent,
      fetch: options.fetch ?? globalFetch()
    })

    this.emails = new Emails(transport)
    this.batch = this.emails.batch
    this.contacts = new Contacts(transport)
    this.lists = new Lists(transport)
    this.broadcasts = new Broadcasts(transport)
    this.templates = new Templates(transport)
  }
}
