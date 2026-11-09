import { z, ZodError } from 'zod'
import type { V1ErrorBody } from '../../../shared/schemas/v1'
import { DomainError, RateLimitedError } from '../core/errors'
import { ApiRateLimitExceededError } from './ApiRateLimiter'
import type { RateLimitState } from './ApiRateLimiter'

export interface ApiErrorResponse {
  status: number
  body: V1ErrorBody
  headers: Record<string, string>
}

/** h3 errors (bad JSON, unknown route…) carry these fields; their messages are client-safe. */
const httpErrorSchema = z.object({
  statusCode: z.number(),
  statusMessage: z.string().optional(),
  message: z.string().optional(),
  data: z.unknown().optional()
})

const STATUS_CODES = new Map([
  [400, 'bad_request'],
  [401, 'unauthorized'],
  [403, 'forbidden'],
  [404, 'not_found'],
  [405, 'method_not_allowed'],
  [409, 'conflict'],
  [413, 'payload_too_large'],
  [415, 'unsupported_media_type'],
  [422, 'validation_error'],
  [429, 'rate_limited']
])

/** Formats zod issues as `field: message` with a machine-readable list. */
function validation(error: ZodError): ApiErrorResponse {
  const issues = error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message
  }))

  const first = issues[0]

  const message = first
    ? first.path
      ? `${first.path}: ${first.message}`
      : first.message
    : 'The request is invalid'

  return {
    status: 422,
    body: { error: { code: 'validation_error', message, details: { issues } } },
    headers: {}
  }
}

export function rateLimitHeaders(state: RateLimitState) {
  return {
    'RateLimit-Limit': String(state.limit),
    'RateLimit-Remaining': String(state.remaining),
    'RateLimit-Reset': String(state.resetSeconds),
    'RateLimit-Policy': `${state.limit};w=60`
  }
}

/**
 * Maps anything thrown while serving a REST API request to the stable
 * `{ error: { code, message } }` shape. Unexpected errors never leak details.
 */
export class ApiErrorMapper {
  static toResponse(cause: unknown): ApiErrorResponse {
    if (cause instanceof ZodError) return validation(cause)

    if (cause instanceof DomainError) return ApiErrorMapper.domain(cause)

    const http = httpErrorSchema.safeParse(cause)

    if (http.success) {
      const error = http.data

      if (error.data instanceof ZodError) return validation(error.data)
      const status = error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500

      if (status >= 500) return ApiErrorMapper.internal()

      const message =
        error.message && error.message !== error.statusMessage
          ? error.message
          : error.statusMessage || 'The request is invalid'

      return {
        status,
        body: { error: { code: STATUS_CODES.get(status) ?? 'bad_request', message } },
        headers: {}
      }
    }

    return ApiErrorMapper.internal()
  }

  /** Domain errors keep their status and code; `data` becomes `details`. */
  static domain(error: DomainError): ApiErrorResponse {
    const headers: Record<string, string> = {}

    if (error instanceof ApiRateLimitExceededError)
      Object.assign(headers, rateLimitHeaders(error.state))

    if (error instanceof RateLimitedError) headers['Retry-After'] = String(error.retryAfterSeconds)
    const body: V1ErrorBody = { error: { code: error.code, message: error.message } }

    if (error.data && Object.keys(error.data).length) body.error.details = error.data

    return { status: error.status, body, headers }
  }

  static internal(): ApiErrorResponse {
    return {
      status: 500,
      body: {
        error: {
          code: 'internal_error',
          message:
            'Something went wrong on our side. Try again; if it keeps failing, check the server logs.'
        }
      },
      headers: {}
    }
  }
}
