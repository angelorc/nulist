import { and, count, gte, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Database } from '../../db/client'
import { apiLogs } from '../../db/schema'
import type { ApiTrafficSummary } from '../../../shared/schemas/transactional'
import type { Paginated } from '../../../shared/types/domain'
import type { ApiLogDetail, ApiLogItem } from '../../../shared/types/logs'
import { LogService } from '../logs/LogService'
import type { ApiLogQuery } from '../../../shared/schemas/logs'
import { PayloadRedactor } from './PayloadRedactor'
import type { TenantScope } from '../core/TenantScope'

/** One REST API request as recorded by `defineApiKeyHandler`. */
export interface ApiLogEntry {
  apiKeyId: string | null
  method: string
  path: string
  statusCode: number
  durationMs: number
  ip?: string | null
  userAgent?: string | null
  /** The body as received or returned; stored in its JSON form. */
  requestBody?: unknown
  responseBody?: unknown
}

/**
 * A logged body in its JSON form, as the client sent or received it (Dates as
 * ISO strings). Bodies that cannot be serialized are not stored.
 */
const loggedBodySchema = z
  .preprocess((body) => {
    try {
      return JSON.parse(JSON.stringify(body) ?? 'null')
    } catch {
      return null
    }
  }, z.json())
  .catch(null)

/**
 * Writes REST API requests to the instance-wide `api_logs` table. Payloads are
 * redacted (secrets) and truncated before storage. The platform container's
 * recorder logs requests rejected before a key (and so an organization) was
 * known, with no organization; organizations record through their ApiLogService.
 */
export class ApiLogRecorder {
  constructor(
    private readonly db: Database,
    private readonly redactor: PayloadRedactor = new PayloadRedactor()
  ) {}

  async record(organizationId: string | null, entry: ApiLogEntry): Promise<void> {
    await this.db.insert(apiLogs).values({
      organizationId,
      apiKeyId: entry.apiKeyId,
      method: entry.method.toUpperCase().slice(0, 10),
      path: this.redactor.redactPath(entry.path).slice(0, 2_000),
      statusCode: entry.statusCode,
      durationMs: Math.max(0, Math.round(entry.durationMs)),
      ip: entry.ip ?? null,
      userAgent: entry.userAgent?.slice(0, 512) ?? null,
      requestBody: this.redactor.redact(loggedBodySchema.parse(entry.requestBody)),
      responseBody: this.redactor.redact(loggedBodySchema.parse(entry.responseBody))
    })
  }
}

/**
 * The REST API request log of one organization: writes go through the
 * recorder with this organization, reads delegate to the organization's LogService.
 */
export class ApiLogService {
  private readonly recorder: ApiLogRecorder
  private readonly reader: LogService

  constructor(
    protected readonly scope: TenantScope,
    protected readonly db: Database,
    recorder: ApiLogRecorder = new ApiLogRecorder(db)
  ) {
    this.recorder = recorder
    this.reader = new LogService(scope, db)
  }

  async record(entry: ApiLogEntry): Promise<void> {
    await this.recorder.record(this.scope.organizationId, entry)
  }

  list(query: ApiLogQuery): Promise<Paginated<ApiLogItem>> {
    return this.reader.apiLogs(query)
  }

  get(id: number): Promise<ApiLogDetail> {
    return this.reader.apiLog(id)
  }

  /** The organization's request volume, error count and median latency since `since`. */
  async summary(since: Date): Promise<ApiTrafficSummary> {
    const [row] = await this.db
      .select({
        total: count(),
        errors: sql<number>`(count(*) filter (where ${apiLogs.statusCode} >= 400))::int`,
        p50: sql<number | null>`percentile_cont(0.5) within group (order by ${apiLogs.durationMs})`
      })
      .from(apiLogs)
      .where(and(this.scope.eq(apiLogs.organizationId), gte(apiLogs.createdAt, since)))

    const p50 = row?.p50 ?? null

    return {
      total: row?.total ?? 0,
      errors: row?.errors ?? 0,
      p50Ms: p50 === null ? null : Math.round(p50)
    }
  }
}
