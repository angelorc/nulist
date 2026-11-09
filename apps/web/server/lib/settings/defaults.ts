import type { GeneralSettings, LimitSettings, SettingsMap } from '../../../shared/types/domain'

/** Instance-wide defaults from the environment (server/lib/core/config.ts). */
export interface EnvDefaults {
  smtpHost: string
  smtpPort: number
  s3Endpoint: string
  s3Region: string
  s3Bucket: string
  s3AccessKeyId: string
  s3SecretAccessKey: string
  s3PublicUrl: string
  /** Limits every organization starts with (NULIST_DEFAULT_*); 0 = unlimited. */
  limits: Partial<LimitSettings>
}

const DEFAULT_LIMITS: LimitSettings = {
  maxContacts: 0,
  maxLists: 0,
  maxSegments: 0,
  maxTemplates: 0,
  dailySendLimit: 0,
  monthlySendLimit: 0,
  maxImportRows: 100_000,
  maxFileSizeMb: 10,
  maxStorageMb: 0,
  apiRequestsPerMinute: 600
}

/** General settings a new organization starts with: its name doubles as workspace and sender name. */
export function generalDefaults(organizationName?: string): GeneralSettings {
  const name = organizationName?.trim()

  return {
    appName: name || 'nulist',
    companyName: name || 'Acme Inc.',
    companyAddress: '',
    defaultFromName: name || 'Acme',
    defaultFromEmail: 'hello@example.com',
    defaultReplyTo: ''
  }
}

/**
 * Settings every organization starts from (stored rows are merged over these).
 * Infrastructure defaults (SMTP relay, S3 bucket) are shared by the instance; their
 * secrets are never revealed and must be re-entered to point them at another host.
 */
export function buildDefaultSettings(env: Partial<EnvDefaults> = {}): SettingsMap {
  return {
    general: generalDefaults(),
    sending: {
      provider: 'smtp',
      ses: { region: 'us-east-1', accessKeyId: '', secretAccessKey: '', configurationSet: '' },
      smtp: {
        host: env.smtpHost ?? 'localhost',
        port: env.smtpPort ?? 1025,
        secure: false,
        user: '',
        pass: '',
        sesHeaders: false,
        configurationSet: ''
      },
      ratePerSecond: 14,
      softBounceThreshold: 3,
      optInExpiryDays: 7
    },
    storage: {
      endpoint: env.s3Endpoint ?? '',
      region: env.s3Region ?? 'us-east-1',
      bucket: env.s3Bucket ?? '',
      accessKeyId: env.s3AccessKeyId ?? '',
      secretAccessKey: env.s3SecretAccessKey ?? '',
      publicUrl: env.s3PublicUrl ?? '',
      forcePathStyle: true
    },
    limits: { ...DEFAULT_LIMITS, ...env.limits }
  }
}
