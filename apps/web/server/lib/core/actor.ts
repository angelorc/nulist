/** Who performed an action — recorded in audit logs. */
export interface Actor {
  type: 'user' | 'api_key' | 'system'
  id: string | null
  label: string
  /**
   * Organization the action was performed in (null for instance-level and system
   * actions). Audit entries take the organization from the scoped AuditLogger,
   * so system actors never need one.
   */
  organizationId: string | null
  ip?: string | null
  userAgent?: string | null
}

export const SYSTEM_ACTOR: Actor = Object.freeze({
  type: 'system',
  id: null,
  label: 'System',
  organizationId: null
})

export function publicActor(
  label = 'Public',
  ip?: string | null,
  userAgent?: string | null,
  organizationId: string | null = null
): Actor {
  return { type: 'system', id: null, label, ip, userAgent, organizationId }
}
