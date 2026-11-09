import { z } from 'zod'
import type { JsonValue } from '../../../shared/types/domain'

export interface RedactorOptions {
  /** Longest string kept verbatim; longer strings are cut with a marker. */
  maxStringLength: number
  /** Largest serialized payload stored; larger payloads keep a truncated preview. */
  maxBytes: number
  /** Deepest nesting level walked. */
  maxDepth: number
}

const DEFAULTS: RedactorOptions = { maxStringLength: 2_000, maxBytes: 32_768, maxDepth: 8 }

/** Keys whose values are never stored in API logs. */
const SECRET_KEY =
  /pass(word)?|secret|token|api[-_]?key|^key$|authorization|cookie|credential|private/i

export const REDACTED = '[redacted]'

const NESTED = '[nested]'

/** One level of a JSON value, classified for the walk (children stay unparsed until visited). */
const jsonNodeSchema = z.union([
  z.string().transform((text) => ({ kind: 'text', text }) as const),
  z.array(z.custom<JsonValue>()).transform((items) => ({ kind: 'list', items }) as const),
  z
    .record(z.string(), z.custom<JsonValue>())
    .transform((record) => ({ kind: 'record', entries: Object.entries(record) }) as const),
  z.custom<JsonValue>().transform((scalar) => ({ kind: 'scalar', scalar }) as const)
])

/**
 * Makes request/response payloads safe and small enough for `api_logs`:
 * strips secrets by key name, shortens long strings and caps the total size.
 */
export class PayloadRedactor {
  private readonly options: RedactorOptions

  constructor(options: Partial<RedactorOptions> = {}) {
    this.options = { ...DEFAULTS, ...options }
  }

  static isSecretKey(key: string): boolean {
    return SECRET_KEY.test(key)
  }

  /** The value to store for a JSON payload (null when empty). */
  redact(value: JsonValue): JsonValue {
    if (value === null || value === '') return null
    const cleaned = this.walk(value, 0)
    const json = JSON.stringify(cleaned)

    if (json.length <= this.options.maxBytes) return cleaned

    return { truncated: true, size: json.length, preview: json.slice(0, this.options.maxBytes) }
  }

  /** Redacts secret query parameters in a request path (`/x?token=…`). */
  redactPath(path: string): string {
    const index = path.indexOf('?')

    if (index < 0) return path
    const params = new URLSearchParams(path.slice(index + 1))

    for (const key of new Set(params.keys())) {
      if (PayloadRedactor.isSecretKey(key)) params.set(key, REDACTED)
    }

    const query = params.toString()

    return query ? `${path.slice(0, index)}?${query}` : path.slice(0, index)
  }

  private walk(value: JsonValue, depth: number): JsonValue {
    const node = jsonNodeSchema.parse(value)

    if (node.kind === 'text') return this.shorten(node.text)

    if (node.kind === 'scalar') return node.scalar

    if (depth >= this.options.maxDepth) return NESTED

    if (node.kind === 'list') return node.items.map((item) => this.walk(item, depth + 1))

    return Object.fromEntries(
      node.entries.map(([key, item]) => [
        key,
        PayloadRedactor.isSecretKey(key) && item !== null && item !== ''
          ? REDACTED
          : this.walk(item, depth + 1)
      ])
    )
  }

  private shorten(value: string): string {
    const max = this.options.maxStringLength

    return value.length > max
      ? `${value.slice(0, max)}… [${value.length - max} more characters]`
      : value
  }
}
