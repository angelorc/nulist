import { z } from 'zod'
import { API_KEY_SCOPES } from '../../../../shared/auth/permissions'
import type { GrantedPermissions } from '../../../../shared/auth/permissions'
import type { ApiKeyScope } from '../../../../shared/types/domain'

/** What nulist stores in a key's Better Auth `metadata`: the scope preset and the creating member. */
const keyMetadataObjectSchema = z.object({
  scope: z.enum(['full', 'sending']).catch('full'),
  createdBy: z.uuid().nullable().catch(null)
})

export type ApiKeyMetadata = z.output<typeof keyMetadataObjectSchema>

const LEGACY_METADATA: ApiKeyMetadata = { scope: 'full', createdBy: null }

/** JSON text decoded into a JSON value (an issue, not an exception, when it is malformed). */
const jsonTextSchema = z.string().transform((text, ctx) => {
  try {
    return z.json().parse(JSON.parse(text))
  } catch {
    ctx.issues.push({ code: 'custom', message: 'Invalid JSON', input: text })

    return z.NEVER
  }
})

/** Better Auth stores metadata as JSON text, sometimes double-encoded. */
const keyMetadataSchema = z
  .union([
    keyMetadataObjectSchema,
    jsonTextSchema.pipe(keyMetadataObjectSchema),
    jsonTextSchema.pipe(jsonTextSchema).pipe(keyMetadataObjectSchema)
  ])
  .catch(LEGACY_METADATA)

/** Better Auth stores permissions as JSON text: `{ resource: actions[] }`. */
const keyPermissionsSchema = jsonTextSchema
  .pipe(z.record(z.string(), z.array(z.string())))
  .nullable()
  .catch(null)

/** Reads a key's metadata defensively; unknown or missing values fall back to a legacy full-access key. */
export function parseKeyMetadata(raw: string | null | undefined): ApiKeyMetadata {
  return keyMetadataSchema.parse(raw ?? null)
}

/** Reads a key's stored permissions (null for keys created before permissions were stored). */
export function parseKeyPermissions(raw: string | null | undefined): GrantedPermissions | null {
  return keyPermissionsSchema.parse(raw ?? null)
}

/** Whether every action in `granted` is part of `preset`. */
function within(granted: GrantedPermissions, preset: GrantedPermissions): boolean {
  return Object.entries(granted).every(([resource, actions]) =>
    (actions ?? []).every((action) => preset[resource]?.includes(action) === true)
  )
}

/**
 * The scope preset a key is labelled with. The stored permissions are
 * authoritative; legacy keys without them fall back to `metadata.scope`.
 */
export function scopeOf(
  metadata: ApiKeyMetadata,
  permissions: GrantedPermissions | null = null
): ApiKeyScope {
  if (!permissions) return metadata.scope

  return within(permissions, API_KEY_SCOPES.sending) ? 'sending' : 'full'
}
