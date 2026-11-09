import { Container } from '../lib/core/Container'
import { loadAppConfig } from '../lib/core/config'
import { NotFoundError } from '../lib/core/errors'
import type { OrganizationContainer } from '../lib/core/OrganizationContainer'
import { WorkflowJobLauncher } from '../lib/core/WorkflowJobLauncher'
import type { OrganizationService } from '../lib/organizations/OrganizationService'

let container: Container | undefined

/**
 * The platform container (one per bundle: the Nitro server and the workflow
 * step bundle each get their own instance). Tenant services come from
 * `useServices().forOrganization(organizationId)`.
 * Importable from workflow steps — must not depend on Nitro auto-imports.
 */
export function useServices(): Container {
  container ??= new Container(loadAppConfig(), { jobs: new WorkflowJobLauncher() })

  return container
}

/** Entities a background job runs on, used to find the organization of older runs. */
export type JobEntity = 'broadcast' | 'contact' | 'import' | 'message' | 'webhookDelivery'

const RESOLVERS = {
  broadcast: (organizations, id) => organizations.organizationOfBroadcast(id),
  contact: (organizations, id) => organizations.organizationOfContact(id),
  import: (organizations, id) => organizations.organizationOfImport(id),
  message: (organizations, id) => organizations.organizationOfMessage(id),
  webhookDelivery: (organizations, id) => organizations.organizationOfWebhookDelivery(id)
} as const satisfies Record<
  JobEntity,
  (organizations: OrganizationService, id: string) => Promise<string | null>
>

/**
 * Services of the organization a workflow step runs in. Runs started before
 * organizations existed carry no organization argument: it is then resolved
 * from the entity the job works on (`NotFoundError` when it no longer exists).
 */
export async function useJobServices(
  organizationId: string | undefined,
  entity: JobEntity,
  id: string
): Promise<OrganizationContainer> {
  const resolved = organizationId ?? (await RESOLVERS[entity](useServices().organizations, id))

  if (!resolved) throw new NotFoundError(entity, id)

  return useServices().forOrganization(resolved)
}
