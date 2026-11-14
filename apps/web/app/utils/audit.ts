import type { ActorType } from '#shared/types/logs'

export interface AuditVerb {
  icon: string
  tone?: string
}

export const AUDIT_ACTORS: Record<ActorType, { icon: string; label: string }> = {
  user: { icon: 'i-lucide-user', label: 'Member' },
  api_key: { icon: 'i-lucide-key-round', label: 'API key' },
  system: { icon: 'i-lucide-cpu', label: 'System' }
}

const VERBS = new Map<string, AuditVerb>([
  ['created', { icon: 'i-lucide-plus' }],
  ['added', { icon: 'i-lucide-plus' }],
  ['duplicated', { icon: 'i-lucide-copy' }],
  ['uploaded', { icon: 'i-lucide-upload' }],
  ['updated', { icon: 'i-lucide-pencil' }],
  ['sent', { icon: 'i-lucide-send' }],
  ['completed', { icon: 'i-lucide-check' }],
  ['deleted', { icon: 'i-lucide-trash-2', tone: 'text-error' }],
  ['removed', { icon: 'i-lucide-trash-2', tone: 'text-error' }]
])

export function auditVerb(action: string): AuditVerb {
  return VERBS.get(action.split('.').at(-1) ?? '') ?? { icon: 'i-lucide-activity' }
}
