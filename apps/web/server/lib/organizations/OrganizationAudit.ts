import { roleLabel } from '../../../shared/auth/permissions'
import type { AuditLogger } from '../audit/AuditLogger'
import type { Actor } from '../core/actor'
import type { StoragePurgeResult } from '../storage/FileService'

/** The organization fields Better Auth hands to its hooks. */
export interface AuditedOrganization {
  id: string
  name: string
  slug: string
}

export interface AuditedMember {
  id: string
  userId: string
  role: string
}

export interface AuditedInvitation {
  id: string
  email: string
  role: string | null
}

/**
 * Audit entries for changes made through Better Auth's organization plugin
 * (its `organizationHooks`). Entries are recorded in the organization they
 * concern; a deleted organization's entry is instance-level.
 */
export class OrganizationAudit {
  constructor(private readonly audit: AuditLogger) {}

  async created(actor: Actor, organization: AuditedOrganization): Promise<void> {
    await this.log(actor, organization.id, {
      action: 'organization.created',
      entityId: organization.id,
      summary: `Created the organization ${organization.name}`,
      changes: { name: organization.name, slug: organization.slug }
    })
  }

  async updated(actor: Actor, organization: AuditedOrganization): Promise<void> {
    await this.log(actor, organization.id, {
      action: 'organization.updated',
      entityId: organization.id,
      summary: `Updated the organization ${organization.name}`,
      changes: { name: organization.name, slug: organization.slug }
    })
  }

  async deleted(actor: Actor, organization: AuditedOrganization): Promise<void> {
    await this.log(actor, null, {
      action: 'organization.deleted',
      entityId: organization.id,
      summary: `Deleted the organization ${organization.name}`,
      changes: { name: organization.name, slug: organization.slug }
    })
  }

  /** Instance-level, like the deletion it precedes. */
  async storagePurged(
    actor: Actor,
    organization: AuditedOrganization,
    result: StoragePurgeResult
  ): Promise<void> {
    const outcomes = {
      purged: {
        action: 'organization.storage_purged',
        summary: `Deleted ${result.objectsRemoved} stored file(s) of ${organization.name}`
      },
      not_configured: {
        action: 'organization.storage_purge_skipped',
        summary: `No storage bucket configured for ${organization.name}: nothing to delete`
      },
      failed: {
        action: 'organization.storage_purge_failed',
        summary: `Could not delete the stored files of ${organization.name}`
      }
    } as const satisfies Record<StoragePurgeResult['state'], { action: string; summary: string }>

    await this.log(actor, null, {
      ...outcomes[result.state],
      entityId: organization.id,
      changes: {
        prefix: result.prefix,
        objectsRemoved: result.objectsRemoved,
        error: result.error
      }
    })
  }

  async memberAdded(
    actor: Actor,
    organization: AuditedOrganization,
    member: AuditedMember,
    email: string
  ): Promise<void> {
    await this.log(actor, organization.id, {
      action: 'member.added',
      entityType: 'member',
      entityId: member.id,
      summary: `Added ${email} as ${roleLabel(member.role)}`,
      changes: { userId: member.userId, email, role: member.role }
    })
  }

  async memberRemoved(
    actor: Actor,
    organization: AuditedOrganization,
    member: AuditedMember,
    email: string
  ): Promise<void> {
    await this.log(actor, organization.id, {
      action: 'member.removed',
      entityType: 'member',
      entityId: member.id,
      summary: `Removed ${email} from ${organization.name}`,
      changes: { userId: member.userId, email, role: member.role }
    })
  }

  async memberRoleUpdated(
    actor: Actor,
    organization: AuditedOrganization,
    member: AuditedMember,
    previousRole: string,
    email: string
  ): Promise<void> {
    await this.log(actor, organization.id, {
      action: 'member.role_updated',
      entityType: 'member',
      entityId: member.id,
      summary: `Changed the role of ${email} to ${roleLabel(member.role)}`,
      changes: { role: { from: previousRole, to: member.role }, email }
    })
  }

  async invitation(
    actor: Actor,
    organization: AuditedOrganization,
    invitation: AuditedInvitation,
    event: 'created' | 'accepted' | 'rejected' | 'canceled'
  ): Promise<void> {
    const verbs = {
      created: `Invited ${invitation.email} as ${roleLabel(invitation.role)}`,
      accepted: `${invitation.email} accepted the invitation`,
      rejected: `${invitation.email} declined the invitation`,
      canceled: `Canceled the invitation of ${invitation.email}`
    } as const satisfies Record<typeof event, string>

    await this.log(actor, organization.id, {
      action: `invitation.${event}`,
      entityType: 'invitation',
      entityId: invitation.id,
      summary: verbs[event],
      changes: { email: invitation.email, role: invitation.role }
    })
  }

  private async log(
    actor: Actor,
    organizationId: string | null,
    entry: {
      action: string
      entityType?: string
      entityId: string
      summary: string
      changes: { [field: string]: string | number | null | { from: string; to: string } }
    }
  ): Promise<void> {
    await this.audit.log(
      { ...actor, organizationId },
      {
        action: entry.action,
        entityType: entry.entityType ?? 'organization',
        entityId: entry.entityId,
        summary: entry.summary,
        changes: entry.changes
      }
    )
  }
}
