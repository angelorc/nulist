import { accessSettingsSchema } from '#shared/schemas/access'
import type { AccessUpdateResult } from '../../lib/access/AccessPolicy'

export default defineInstanceAdminHandler(
  async (event, { platform, actor, user }): Promise<AccessUpdateResult> => {
    const input = await readValidatedBody(event, accessSettingsSchema.parse)

    return platform.access.update(input, actor, user.email)
  }
)
