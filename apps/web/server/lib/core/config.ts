import type { LimitSettings } from '../../../shared/types/domain'
import type { AppConfig } from './Container'

const DEV_SECRET = 'dev-only-secret-change-me-dev-only-secret-change-me'

type Env = Readonly<Record<string, string | undefined>>

/** Env variable per limit: the limits every new organization starts with. */
const LIMIT_ENV: readonly (readonly [keyof LimitSettings, string])[] = [
  ['maxContacts', 'MLIST_DEFAULT_MAX_CONTACTS'],
  ['maxLists', 'MLIST_DEFAULT_MAX_LISTS'],
  ['maxSegments', 'MLIST_DEFAULT_MAX_SEGMENTS'],
  ['maxTemplates', 'MLIST_DEFAULT_MAX_TEMPLATES'],
  ['dailySendLimit', 'MLIST_DEFAULT_DAILY_SEND_LIMIT'],
  ['monthlySendLimit', 'MLIST_DEFAULT_MONTHLY_SEND_LIMIT'],
  ['maxImportRows', 'MLIST_DEFAULT_MAX_IMPORT_ROWS'],
  ['maxFileSizeMb', 'MLIST_DEFAULT_MAX_FILE_SIZE_MB'],
  ['maxStorageMb', 'MLIST_DEFAULT_MAX_STORAGE_MB'],
  ['apiRequestsPerMinute', 'MLIST_DEFAULT_API_REQUESTS_PER_MINUTE']
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
      env.NUXT_DATABASE_URL || env.DATABASE_URL || 'postgres://mlist:mlist@localhost:5442/mlist',
    appSecret,
    appUrl: env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000',
    snsTopicArns: list(env.NUXT_SNS_TOPIC_ARNS),
    trustedProxies: list(env.MLIST_TRUSTED_PROXIES),
    outbound: {
      allowPrivateNetworks: env.MLIST_ALLOW_PRIVATE_TARGETS === 'true',
      allowedTargets: list(env.MLIST_ALLOWED_TARGETS)
    },
    organizationCacheSize: count(env.MLIST_ORGANIZATION_CACHE_SIZE) || 200,
    defaults: {
      smtpHost: env.MLIST_SMTP_HOST || 'localhost',
      smtpPort: Number(env.MLIST_SMTP_PORT || 1026),
      s3Endpoint: env.MLIST_S3_ENDPOINT ?? 'http://localhost:9000',
      s3Region: env.MLIST_S3_REGION || 'us-east-1',
      s3Bucket: env.MLIST_S3_BUCKET ?? 'mlist',
      s3AccessKeyId: env.MLIST_S3_ACCESS_KEY_ID ?? 'mlist',
      s3SecretAccessKey: env.MLIST_S3_SECRET_ACCESS_KEY ?? 'mlist-secret',
      s3PublicUrl: env.MLIST_S3_PUBLIC_URL ?? 'http://localhost:9000/mlist',
      limits: limitDefaults(env)
    }
  }
}
