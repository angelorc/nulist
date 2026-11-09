import type { Tag } from '@aws-sdk/client-sesv2'

/** SES resource tag that records which organization an identity belongs to. */
export const ORGANIZATION_TAG = 'nulist:organization-id'

/** How an organization reaches Amazon SES. */
export type SesAccountKind =
  /** Access keys entered by the organization: an AWS account it controls. */
  | 'dedicated'
  /** The server's AWS credential chain: the instance's account, shared by every organization. */
  | 'shared'

/**
 * Which SES identities an organization may see and manage. Identities created
 * through nulist carry the organization's id as a tag; an identity tagged for
 * another organization never belongs to this one. Untagged identities (created
 * in the AWS console or before organizations existed) belong to the organization
 * only when it uses its own AWS account, never on the shared instance account.
 */
export class IdentityOwnership {
  constructor(
    readonly organizationId: string,
    readonly account: SesAccountKind
  ) {}

  /** Tags written on identities this organization creates. */
  get tags(): Tag[] {
    return [{ Key: ORGANIZATION_TAG, Value: this.organizationId }]
  }

  /** Whether untagged identities may be created when tagging is not permitted (dedicated accounts only). */
  get allowsUntagged(): boolean {
    return this.account === 'dedicated'
  }

  /** Whether an identity with these tags belongs to the organization. */
  owns(tags: readonly Tag[] | undefined): boolean {
    const owner = tags?.find((tag) => tag.Key === ORGANIZATION_TAG)?.Value

    if (owner) return owner === this.organizationId

    return this.account === 'dedicated'
  }
}
