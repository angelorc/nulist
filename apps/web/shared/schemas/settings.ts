import { z } from 'zod'

const emailOrEmpty = z.union([z.literal(''), z.email()])

export const generalSettingsSchema = z.object({
  appName: z.string().trim().min(1).max(80),
  companyName: z.string().trim().max(120),
  companyAddress: z.string().trim().max(300),
  defaultFromName: z.string().trim().max(120),
  defaultFromEmail: emailOrEmpty,
  defaultReplyTo: emailOrEmpty
})

export const sendingSettingsSchema = z.object({
  provider: z.enum(['ses', 'smtp']),
  ses: z.object({
    region: z.string().trim().max(40),
    accessKeyId: z.string().trim().max(128),
    secretAccessKey: z.string().trim().max(256),
    configurationSet: z.string().trim().max(64)
  }),
  smtp: z.object({
    host: z.string().trim().max(255),
    port: z.coerce.number().int().min(1).max(65535),
    secure: z.boolean(),
    user: z.string().trim().max(255),
    pass: z.string().max(512),
    sesHeaders: z.boolean(),
    configurationSet: z.string().trim().max(64)
  }),
  ratePerSecond: z.coerce.number().int().min(1).max(1000),
  softBounceThreshold: z.coerce.number().int().min(1).max(50),
  optInExpiryDays: z.coerce.number().int().min(1).max(60)
})

/** File URLs become links in the dashboard and emails: http(s) only (never javascript: or data:). */
const httpUrlOrEmpty = z.union([
  z.literal(''),
  z.url({ protocol: /^https?$/, error: 'Enter a valid http(s) URL' })
])

export const storageSettingsSchema = z.object({
  endpoint: httpUrlOrEmpty,
  region: z.string().trim().max(40),
  bucket: z.string().trim().max(63),
  accessKeyId: z.string().trim().max(128),
  secretAccessKey: z.string().trim().max(256),
  publicUrl: httpUrlOrEmpty,
  forcePathStyle: z.boolean()
})

const limit = z.coerce.number().int().min(0).max(1_000_000_000)

export const limitSettingsSchema = z.object({
  maxContacts: limit,
  maxLists: limit,
  maxSegments: limit,
  maxTemplates: limit,
  dailySendLimit: limit,
  monthlySendLimit: limit,
  maxImportRows: limit,
  maxFileSizeMb: limit,
  maxStorageMb: limit,
  apiRequestsPerMinute: limit
})

export const settingsSchemas = {
  general: generalSettingsSchema,
  sending: sendingSettingsSchema,
  storage: storageSettingsSchema,
  limits: limitSettingsSchema
} as const

/** Value sent back to the UI in place of a stored secret. Sending it back keeps the stored value. */
export const MASKED_SECRET = '••••••••'
