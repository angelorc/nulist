import { isJsonObject, isJsonString } from './json'
import type { JsonObject, JsonValue } from './json'

/** Codes the mlist API sends in `error.code`. */
export const API_ERROR_NAMES = [
  'missing_api_key',
  'invalid_authorization_header',
  'invalid_api_key',
  'api_key_expired',
  'api_key_disabled',
  'unauthorized',
  'insufficient_scope',
  'forbidden',
  'bad_request',
  'validation_error',
  'unsupported_media_type',
  'payload_too_large',
  'not_found',
  'route_not_found',
  'method_not_allowed',
  'conflict',
  'invalid_state',
  'contact_exists',
  'slug_taken',
  'limit_exceeded',
  'invalid_idempotent_request',
  'concurrent_idempotent_request',
  'rate_limited',
  'provider_error',
  'internal_error'
] as const

/** Codes produced by the SDK itself; the API never sends them. */
export const CLIENT_ERROR_NAMES = [
  /** A path parameter is `.` or `..`, or the body or a header cannot be sent as given. */
  'invalid_parameter',
  /** A required path parameter is empty. */
  'missing_required_field',
  /** The caller's `signal` aborted the request (including `AbortSignal.timeout`). */
  'request_aborted',
  /** No response, or a response that is not the API's JSON (proxy page, HTML error…). */
  'application_error'
] as const

export type ApiErrorName = (typeof API_ERROR_NAMES)[number]

export type ClientErrorName = (typeof CLIENT_ERROR_NAMES)[number]

export type MlistErrorName = ApiErrorName | ClientErrorName

/**
 * The codes this SDK version knows, plus any newer code the API sends (passed
 * through unchanged instead of being collapsed into `application_error`).
 */
export type ErrorName = MlistErrorName | (string & {})

/** What every failed call resolves to (`{ data: null, error }`); the SDK never throws or rejects. */
export interface ErrorResponse {
  /** Machine-readable code: the API's `error.code` (exposed as `name`). */
  name: ErrorName
  message: string
  /** HTTP status, or `null` when the request was never answered. */
  statusCode: number | null
  /** The API's `error.details`, e.g. `{ issues: [{ path, message }] }` for validation errors. */
  details?: JsonObject
}

/**
 * The body of an API error: `{ error: { code, message, details? } }`. A type
 * alias (not an interface) so that it narrows a parsed `JsonValue`.
 */
type ApiErrorBody = {
  readonly error: {
    readonly code: string
    readonly message: string
    readonly details?: JsonObject
  }
}

function isApiErrorBody(value: JsonValue | undefined): value is ApiErrorBody {
  if (!isJsonObject(value) || !isJsonObject(value.error)) return false
  const { code, message, details } = value.error

  return (
    isJsonString(code) && isJsonString(message) && (details === undefined || isJsonObject(details))
  )
}

/** Builds the error responses of failed calls, from the API's error body or from the client. */
export class ErrorResponses {
  /** An error the SDK detected before or instead of reaching the API. */
  static client(
    name: ClientErrorName,
    message: string,
    statusCode: number | null = null
  ): ErrorResponse {
    return { name, message, statusCode }
  }

  /**
   * Unwraps `{ error: { code, message, details } }`, keeping codes this SDK does
   * not know yet; a body of another shape becomes `application_error`.
   */
  static fromApi(body: JsonValue | undefined, status: number, statusText: string): ErrorResponse {
    if (!isApiErrorBody(body)) {
      const message =
        status >= 500
          ? 'Internal server error. We are unable to process your request right now, please try again later.'
          : statusText || `Unexpected ${status} response from the mlist API.`

      return ErrorResponses.client('application_error', message, status)
    }

    const { code: name, message, details } = body.error

    return details === undefined
      ? { name, message, statusCode: status }
      : { name, message, statusCode: status, details }
  }
}
