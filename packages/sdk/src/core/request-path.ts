import { ErrorResponses } from './errors'
import type { ErrorResponse } from './errors'

/** Values of the `{name}` placeholders of a path template. */
export type PathParameters = Readonly<Record<string, string>>

/** Query string values; `undefined`, `null` and `''` are left out. */
export type QueryParameters = Readonly<Record<string, string | number | boolean | null | undefined>>

const PLACEHOLDER = /\{(\w+)\}/g

/**
 * An API path built from a template such as `/contacts/{email}`. Parameters are
 * percent-encoded; an empty parameter or a `.` / `..` segment (which would make
 * the request reach another endpoint) is recorded as `problem` and the request
 * is never sent.
 */
export class RequestPath {
  private constructor(
    readonly value: string,
    readonly problem: ErrorResponse | null
  ) {}

  static of(template: string, parameters: PathParameters = {}): RequestPath {
    let problem: ErrorResponse | null = null

    const value = template.replace(PLACEHOLDER, (_placeholder, name: string) => {
      const parameter = parameters[name] ?? ''

      if (!parameter.trim()) {
        problem ??= ErrorResponses.client('missing_required_field', `Missing \`${name}\`.`)
      } else if (parameter === '.' || parameter === '..') {
        problem ??= ErrorResponses.client(
          'invalid_parameter',
          `\`${name}\` cannot be \`.\` or \`..\`.`
        )
      }

      return encodeURIComponent(parameter)
    })

    return new RequestPath(value, problem)
  }

  /** The path with its query string (entries without a value are skipped). */
  withQuery(query: QueryParameters = {}): string {
    const search = new URLSearchParams()

    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') search.append(key, String(value))
    }

    const encoded = search.toString()

    return encoded ? `${this.value}?${encoded}` : this.value
  }
}
