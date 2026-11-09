import type { LimitSettings } from '../../../shared/types/domain'
import type { AppConfig } from './Container'

const DEV_SECRET = 'dev-only-secret-change-me-dev-only-secret-change-me'

type Env = Readonly<Record<string, string | undefined>>

/** Env variable per limit: the limits every new organization starts with. */
const LIMIT_ENV: readonly (readonly [keyof LimitSettings, string])[] = [
  ['maxContacts', 'NULIST_DEFAULT_MAX_CONTACTS'],
  ['maxLists', 'NULIST_DEFAULT_MAX_LISTS'],
  ['maxSegments', 'NULIST_DEFAULT_MAX_SEGMENTS'],
  ['maxTemplates', 'NULIST_DEFAULT_MAX_TEMPLATES'],
  ['dailySendLimit', 'NULIST_DEFAULT_DAILY_SEND_LIMIT'],
  ['monthlySendLimit', 'NULIST_DEFAULT_MONTHLY_SEND_LIMIT'],
  ['maxImportRows', 'NULIST_DEFAULT_MAX_IMPORT_ROWS'],
  ['maxFileSizeMb', 'NULIST_DEFAULT_MAX_FILE_SIZE_MB'],
  ['maxStorageMb', 'NULIST_DEFAULT_MAX_STORAGE_MB'],
  ['apiRequestsPerMinute', 'NULIST_DEFAULT_API_REQUESTS_PER_MINUTE']
]

/** Non-negative integer from the environment, or undefined when unset or invalid. */
function count(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined
  const parsed = Number(value)

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

/** Comma-separated values, trimmed, empty ones dropped. */
function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function limitDefaults(env: Env): Partial<LimitSettings> {
  const limits: Partial<LimitSettings> = {}

  for (const [key, name] of LIMIT_ENV) {
    const value = count(env[name])

    if (value !== undefined) limits[key] = value
  }

  return limits
}

/**
 * Reads configuration from the environment. Deliberately does not use Nitro's
 * `useRuntimeConfig`: workflow steps are bundled separately (esbuild) and
 * cannot resolve Nitro auto-imports.
 */
export function loadAppConfig(env: Env = process.env): AppConfig {
  const appSecret = env.NUXT_APP_SECRET || DEV_SECRET

  if (env.NODE_ENV === 'production' && appSecret === DEV_SECRET) {
    throw new Error('NUXT_APP_SECRET must be set in production')
  }

  return {
    databaseUrl:
      env.NUXT_DATABASE_URL || env.DATABASE_URL || 'postgres://nulist:nulist@localhost:5442/nulist',
    appSecret,
    appUrl: env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000',
    snsTopicArns: list(env.NUXT_SNS_TOPIC_ARNS),
    trustedProxies: list(env.NULIST_TRUSTED_PROXIES),
    outbound: {
      allowPrivateNetworks: env.NULIST_ALLOW_PRIVATE_TARGETS === 'true',
      allowedTargets: list(env.NULIST_ALLOWED_TARGETS)
    },
    organizationCacheSize: count(env.NULIST_ORGANIZATION_CACHE_SIZE) || 200,
    defaults: {
      smtpHost: env.NULIST_SMTP_HOST || 'localhost',
      smtpPort: Number(env.NULIST_SMTP_PORT || 1026),
      s3Endpoint: env.NULIST_S3_ENDPOINT ?? 'http://localhost:9000',
      s3Region: env.NULIST_S3_REGION || 'us-east-1',
      s3Bucket: env.NULIST_S3_BUCKET ?? 'nulist',
      s3AccessKeyId: env.NULIST_S3_ACCESS_KEY_ID ?? 'nulist',
      s3SecretAccessKey: env.NULIST_S3_SECRET_ACCESS_KEY ?? 'nulist-secret',
      s3PublicUrl: env.NULIST_S3_PUBLIC_URL ?? 'http://localhost:9000/nulist',
      limits: limitDefaults(env)
    }
  }
}
