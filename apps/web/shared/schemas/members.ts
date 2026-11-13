import { z } from 'zod'
import { DEFAULT_INVITE_ROLE } from '../auth/permissions'
import type { OrgRole } from '../auth/permissions'

/** Organization roles a member can hold or be invited with (see ROLE_OPTIONS for labels). */
export const ORG_ROLES = [
  'owner',
  'admin',
  'editor',
  'member'
] as const satisfies readonly OrgRole[]

export const memberRoleSchema = z.enum(ORG_ROLES)

export const memberUpdateSchema = z.object({ role: memberRoleSchema })

export type MemberUpdateInput = z.infer<typeof memberUpdateSchema>

export const invitationCreateSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
  role: memberRoleSchema.default(DEFAULT_INVITE_ROLE)
})

export type InvitationCreateInput = z.output<typeof invitationCreateSchema>

export const invitationResponseSchema = z.object({ action: z.enum(['accept', 'reject']) })

export type InvitationResponseInput = z.infer<typeof invitationResponseSchema>

/** Better Auth invitation states. */
export const INVITATION_STATUSES = ['pending', 'accepted', 'rejected', 'canceled'] as const

export const invitationStatusSchema = z.enum(INVITATION_STATUSES)

export type InvitationStatus = z.infer<typeof invitationStatusSchema>

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/** A member of the active organization (GET /api/members). */
export interface OrganizationMember {
  /** Membership id (`member.id`), used by the member endpoints. */
  id: string
  userId: string
  name: string
  email: string
  image: string | null
  /** Stored role value (Better Auth allows several, comma-separated). */
  role: string
  /** Whether the member is an owner of the organization. */
  isOwner: boolean
  /** Banned by an instance administrator: the account cannot sign in. */
  banned: boolean
  createdAt: string
  /** Most recent session activity of the user, if any. */
  lastActiveAt: string | null
  isCurrentUser: boolean
}

/** GET /api/members: the members plus what the UI needs for its last-owner lock. */
export interface MemberDirectory {
  members: OrganizationMember[]
  ownerCount: number
}

/** A pending invitation of the active organization (GET/POST /api/invitations). */
export interface PendingInvitation {
  id: string
  email: string
  role: string
  status: InvitationStatus
  /** Name (or email) of the member who sent it. */
  invitedBy: string | null
  createdAt: string
  expiresAt: string
  expired: boolean
  /** Link the invitee opens to accept (copy-link fallback when no email could be sent). */
  url: string
}

/** GET /api/invitations/[id]: what an invitee (possibly signed out) may see. */
export interface InvitationDetails {
  id: string
  organizationName: string
  organizationLogo: string | null
  inviterName: string | null
  email: string
  role: string
  status: InvitationStatus
  expiresAt: string
  expired: boolean
  /** Whether an account with the invited email already exists (sign in instead of sign up). */
  accountExists: boolean
}

/** GET /api/invitations/mine: pending invitations addressed to the signed-in user. */
export interface ReceivedInvitation {
  id: string
  organizationName: string
  organizationLogo: string | null
  inviterName: string | null
  role: string
  expiresAt: string
}

/** POST /api/invitations/[id], POST /api/organization/leave, DELETE /api/organization. */
export interface ActiveOrganizationChange {
  /** The organization now active on the session (null: the user belongs to none). */
  organizationId: string | null
}
