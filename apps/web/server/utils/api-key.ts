import type { H3Event } from 'h3'
import { grants } from '../../shared/auth/permissions'
import type { PermissionRequest } from '../../shared/auth/permissions'
import type { Actor } from '../lib/core/actor'
import type { Container } from '../lib/core/Container'
import { DomainError } from '../lib/core/errors'
import type { OrganizationContainer } from '../lib/core/OrganizationContainer'
import { ApiErrorMapper, rateLimitHeaders } from '../lib/api/ApiErrorMapper'
import {
  ApiAuthenticationError,
  BetterAuthApiKeyVerifier,
  OrganizationBoundApiKeyVerifier,
  verifyApiKeyApi
} from '../lib/api/ApiKeyVerifier'
import type { ApiKeyIdentity } from '../lib/api/ApiKeyVerifier'
import type { ApiLogEntry } from '../lib/api/ApiLogService'
import { ApiRateLimiter } from '../lib/api/ApiRateLimiter'
import { requestActor } from './api'
import { useServices } from './services'

export interface ApiKeyHandlerContext {
  /** Tenant services of the key's organization. */
  services: OrganizationContainer
  platform: Container
  actor: Actor
  apiKey: ApiKeyIdentity
}

export interface ApiKeyHandlerOptions {
  /** What the key's permissions must cover (403 `insufficient_scope` otherwise). */
  permission: PermissionRequest
}

/** 403 when the key is valid but its permissions do not cover the endpoint. */
export class InsufficientPermissionError extends DomainError {
  constructor(required: PermissionRequest) {
    super(
      'This API key does not have permission to use this endpoint.',
      403,
      'insufficient_scope',
      { required }
    )
  }
}

/** One budget per key and server process, shared by every v1 endpoint. */
const rateLimiter = new ApiRateLimiter()

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const JSON_METHODS = new Set(['POST', 'PUT', 'PATCH'])

/** `Authorization: Bearer <key>` (preferred) or `x-api-key: <key>`. */
function extractKey(event: H3Event): string {
  const authorization = getRequestHeader(event, 'authorization')?.trim()

  if (authorization) {
    const [scheme, ...rest] = authorization.split(/\s+/)
    const token = rest.join(' ').trim()

    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new ApiAuthenticationError(
        'Use "Authorization: Bearer <api key>".',
        'invalid_authorization_header'
      )
    }

    return token
  }

  const header = getRequestHeader(event, 'x-api-key')?.trim()

  if (header) return header
  throw new ApiAuthenticationError(
    'Missing API key. Send it as "Authorization: Bearer <api key>".',
    'missing_api_key'
  )
}

/** A non-empty body must be JSON: a missing Content-Type would otherwise be parsed as a form. */
function assertJsonBody(event: H3Event): void {
  if (!JSON_METHODS.has(event.method)) return
  const length = Number(getRequestHeader(event, 'content-length') ?? 0)
  const chunked = !!getRequestHeader(event, 'transfer-encoding')

  if (!length && !chunked) return
  const type = getRequestHeader(event, 'content-type') ?? ''

  if (!/[/+]json\b/i.test(type)) {
    throw new DomainError(
      'Send the request body as JSON with "Content-Type: application/json".',
      415,
      'unsupported_media_type'
    )
  }
}

/** The parsed request body for the log (cached by h3 when the handler read it). */
async function capturedBody(event: H3Event): Promise<ApiLogEntry['requestBody']> {
  if (!BODY_METHODS.has(event.method)) return null

  try {
    return await readBody(event)
  } catch {
    try {
      return (await readRawBody(event)) ?? null
    } catch {
      return null
    }
  }
}

/**
 * REST API v1 endpoint authenticated with a Better Auth API key of one
 * organization. Verifies the key (organization = its `referenceId`), checks its
 * permissions against `options.permission` locally, applies the organization's
 * per-key rate limit, maps every error to `{ error: { code, message } }` and
 * records the request in the organization's `api_logs`.
 */
export function defineApiKeyHandler<T>(
  handler: (event: H3Event, ctx: ApiKeyHandlerContext) => T | Promise<T>,
  options: ApiKeyHandlerOptions
) {
  return defineEventHandler(async (event) => {
    const startedAt = performance.now()
    const platform = useServices()
    let services: OrganizationContainer | null = null
    let apiKey: ApiKeyIdentity | null = null
    let responseBody: ApiLogEntry['responseBody'] = null

    try {
      const verifier = new OrganizationBoundApiKeyVerifier(
        new BetterAuthApiKeyVerifier(verifyApiKeyApi(serverAuth(event).api)),
        platform.organizations
      )

      apiKey = await verifier.verify(extractKey(event))
      services = platform.forOrganization(apiKey.organizationId)

      // Every authenticated request counts, including the ones rejected below.
      const { apiRequestsPerMinute } = await services.settings.get('limits')

      const limit = await rateLimiter.consume(
        `${apiKey.organizationId}:${apiKey.id}`,
        apiRequestsPerMinute
      )

      if (limit) setResponseHeaders(event, rateLimitHeaders(limit))

      if (!grants(apiKey.permissions, options.permission))
        throw new InsufficientPermissionError(options.permission)
      assertJsonBody(event)

      const actor = requestActor(
        event,
        {
          type: 'api_key',
          id: apiKey.id,
          label: apiKey.name ? `API key "${apiKey.name}"` : `API key ${apiKey.start ?? apiKey.id}`
        },
        apiKey.organizationId
      )

      responseBody = await handler(event, { services, platform, actor, apiKey })
      setResponseHeader(event, 'cache-control', 'no-store')

      return responseBody
    } catch (cause) {
      const response = ApiErrorMapper.toResponse(cause)

      if (response.status >= 500) console.error(`[api] ${event.method} ${event.path} failed`, cause)
      setResponseStatus(event, response.status)
      setResponseHeaders(event, { ...response.headers, 'cache-control': 'no-store' })
      responseBody = response.body

      return response.body
    } finally {
      // Requests without a valid key belong to no organization: logged without one,
      // and without the body an unknown client sent.
      const requestBody = services ? await capturedBody(event) : null

      const entry: ApiLogEntry = {
        apiKeyId: apiKey?.id ?? null,
        method: event.method,
        path: event.path,
        statusCode: getResponseStatus(event),
        durationMs: performance.now() - startedAt,
        ip: getRequestIP(event, { xForwardedFor: true }) ?? null,
        userAgent: getRequestHeader(event, 'user-agent') ?? null,
        requestBody,
        responseBody
      }

      const recorded = services
        ? services.apiLogs.record(entry)
        : platform.apiLogRecorder.record(null, entry)

      event.waitUntil(
        recorded.catch((cause: unknown) => {
          console.error('[api] could not record the request log', cause)
        })
      )
    }
  })
}

/**
 * Fallback for methods a v1 route does not implement: 204 for CORS preflight,
 * otherwise a JSON 405 with an `Allow` header (instead of the HTML 404 page).
 */
export function defineApiMethodFallback(allowed: readonly string[]) {
  const notAllowed = defineApiKeyHandler(
    (event) => {
      setResponseHeader(event, 'allow', allowed.join(', '))
      throw new DomainError(
        `${event.method} is not supported on this endpoint. Use ${allowed.join(' or ')}.`,
        405,
        'method_not_allowed',
        { allowed: [...allowed] }
      )
    },
    // Any valid key learns which methods exist, whatever its permissions.
    { permission: {} }
  )

  return defineEventHandler((event) =>
    event.method === 'OPTIONS' ? sendNoContent(event, 204) : notAllowed(event)
  )
}
