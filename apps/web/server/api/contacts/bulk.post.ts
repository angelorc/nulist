import { CONTACT_BULK_PERMISSIONS, contactBulkSchema } from '#shared/schemas/contacts'
import { PermissionDeniedError } from '../../lib/core/errors'

/**
 * Every bulk action changes contacts (`contact:update`); each action then
 * checks its own permission, so deleting also needs `contact:delete`.
 */
export default defineApiHandler(
  async (event, { services, actor, can }) => {
    const body = await readValidatedBody(event, contactBulkSchema.parse)
    const required = CONTACT_BULK_PERMISSIONS[body.action]

    if (!can(required)) throw new PermissionDeniedError(required)

    return services.contacts.bulk(body, actor)
  },
  { permission: { contact: ['update'] } }
)
