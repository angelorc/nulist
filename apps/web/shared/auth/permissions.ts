import { createAccessControl } from 'better-auth/plugins/access'
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc
} from 'better-auth/plugins/organization/access'
import type { ApiKeyScope } from '../types/domain'

/**
 * Organization access control shared by the server (route guards, Better Auth
 * organization plugin), the client (UI gating) and the auth CLI (schema).
 * Import it relatively from server/lib, server/workflows and scripts.
 */
export const statements = {
  ...defaultStatements,
  member: ['create', 'read', 'update', 'delete'],
  contact: ['create', 'read', 'update', 'delete', 'import', 'export'],
  list: ['create', 'read', 'update', 'delete'],
  segment: ['create', 'read', 'update', 'delete'],
  topic: ['create', 'read', 'update', 'delete'],
  template: ['create', 'read', 'update', 'delete'],
  file: ['create', 'read', 'delete'],
  broadcast: ['create', 'read', 'update', 'delete', 'send'],
  transactional: ['read', 'send'],
  webhook: ['create', 'read', 'update', 'delete'],
  settings: ['read', 'update'],
  domain: ['create', 'read', 'update', 'delete'],
  // Exact name required by @better-auth/api-key for organization-owned keys.
  apiKey: ['create', 'read', 'update', 'delete'],
  suppression: ['create', 'read', 'delete'],
  audit: ['read'],
  analytics: ['read'],
  log: ['read']
} as const

export type Statements = typeof statements

export type Resource = keyof Statements

export type Action<R extends Resource> = Statements[R][number]

/** Actions required per resource; every listed action of every listed resource must be granted. */
export type PermissionRequest = { [R in Resource]?: readonly Action<R>[] }

export const ac = createAccessControl(statements)

/** Content work: audience, templates, files, sending, suppressions and reporting. */
const content = {
  contact: statements.contact,
  list: statements.list,
  segment: statements.segment,
  topic: statements.topic,
  template: statements.template,
  file: statements.file,
  broadcast: statements.broadcast,
  transactional: statements.transactional,
  suppression: statements.suppression,
  analytics: statements.analytics,
  log: statements.log
} as const

/** Organization operations: members, integrations, settings and the audit trail. */
const operations = {
  member: statements.member,
  webhook: statements.webhook,
  settings: statements.settings,
  domain: statements.domain,
  apiKey: statements.apiKey,
  audit: statements.audit
} as const

/** Read access to every app resource except API keys and the audit trail. */
const readOnly = {
  member: ['read'],
  contact: ['read'],
  list: ['read'],
  segment: ['read'],
  topic: ['read'],
  template: ['read'],
  file: ['read'],
  broadcast: ['read'],
  transactional: ['read'],
  webhook: ['read'],
  settings: ['read'],
  domain: ['read'],
  suppression: ['read'],
  analytics: ['read'],
  log: ['read']
} as const

export const owner = ac.newRole({ ...ownerAc.statements, ...content, ...operations })

/** Everything except deleting the organization. */
export const admin = ac.newRole({ ...adminAc.statements, ...content, ...operations })

/** "Marketer": full content work, read-only elsewhere, no API keys, members or audit trail. */
export const editor = ac.newRole({ ...memberAc.statements, ...readOnly, ...content })

/** "Viewer": read-only. Default role for invitations. */
export const member = ac.newRole({ ...memberAc.statements, ...readOnly })

/** Better Auth always accepts owner/admin/member, so all three must be defined here. */
export const roles = { owner, admin, editor, member }

export type OrgRole = keyof typeof roles

export interface RoleOption {
  value: OrgRole
  label: string
  description: string
}

export const ROLE_OPTIONS = [
  {
    value: 'owner',
    label: 'Owner',
    description: 'Full access, including deleting the organization and managing owners.'
  },
  {
    value: 'admin',
    label: 'Admin',
    description: 'Full access to the organization except deleting it.'
  },
  {
    value: 'editor',
    label: 'Marketer',
    description:
      'Manages contacts, content and sending. Read-only on settings; no API keys, members or audit log.'
  },
  {
    value: 'member',
    label: 'Viewer',
    description: 'Read-only access. Cannot see API keys or the audit log.'
  }
] as const satisfies readonly RoleOption[]

export const DEFAULT_INVITE_ROLE: OrgRole = 'member'

export function isOrgRole(value: string): value is OrgRole {
  return Object.hasOwn(roles, value)
}

export function isResource(value: string): value is Resource {
  return Object.hasOwn(statements, value)
}

/** Known roles in a stored role value (Better Auth stores multiple roles comma-separated). */
export function parseRoles(roleValue: string | null | undefined): OrgRole[] {
  if (!roleValue) return []

  return roleValue
    .split(',')
    .map((name) => name.trim())
    .filter(isOrgRole)
}

/**
 * Same semantics as Better Auth's permission check: any of the (comma-separated)
 * roles must grant every requested action; unknown roles grant nothing.
 * Pure, so it works on the server, the client and during SSR.
 */
export function can(roleValue: string | null | undefined, request: PermissionRequest): boolean {
  return parseRoles(roleValue).some((name) => roles[name].authorize(request).success)
}

const GRANTS: ReadonlyMap<OrgRole, ReadonlySet<string>> = new Map(
  ROLE_OPTIONS.map(({ value }) => [
    value,
    new Set(
      Object.entries(roles[value].statements).flatMap(([resource, actions]) =>
        actions.map((action: string) => `${resource}:${action}`)
      )
    )
  ])
)

function setActions<R extends Resource>(
  target: { [K in R]?: readonly Action<K>[] },
  resource: R,
  actions: Action<R>[]
): void {
  if (actions.length) target[resource] = actions
}

/** Every action granted by the role value, per resource (resources without actions are omitted). */
export function permissionsOf(roleValue: string | null | undefined): PermissionRequest {
  const names = parseRoles(roleValue)
  const granted: PermissionRequest = {}

  for (const resource of Object.keys(statements).filter(isResource)) {
    setActions(
      granted,
      resource,
      statements[resource].filter((action) =>
        names.some((name) => GRANTS.get(name)?.has(`${resource}:${action}`))
      )
    )
  }

  return granted
}

/**
 * Permissions stored on API keys created with each scope preset. Keys are
 * authorized locally against these (falling back to the preset for keys
 * created before permissions were stored).
 */
export const API_KEY_SCOPES = {
  full: {
    contact: ['create', 'read', 'update', 'delete', 'import', 'export'],
    list: ['create', 'read', 'update', 'delete'],
    segment: ['read'],
    topic: ['read'],
    template: ['create', 'read', 'update', 'delete'],
    broadcast: ['create', 'read', 'update', 'delete', 'send'],
    transactional: ['read', 'send'],
    suppression: ['read']
  },
  sending: { transactional: ['read', 'send'] }
} as const satisfies Record<ApiKeyScope, PermissionRequest>

/** Permissions stored on an API key (Better Auth `permissions` column), by resource. */
export interface GrantedPermissions {
  readonly [resource: string]: readonly string[] | undefined
}

/** Whether `granted` (an API key's permissions) covers every action in `required`. */
export function grants(granted: GrantedPermissions, required: PermissionRequest): boolean {
  return Object.entries(required).every(([resource, actions]) => {
    const allowed = granted[resource] ?? []

    return (actions ?? []).every((action) => allowed.includes(action))
  })
}

/** Human label of a role value ("Marketer", "Owner, Admin"); unknown roles keep their name. */
export function roleLabel(roleValue: string | null | undefined): string {
  const labels = (roleValue ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ROLE_OPTIONS.find((option) => option.value === name)?.label ?? name)

  return labels.join(', ') || 'Viewer'
}
