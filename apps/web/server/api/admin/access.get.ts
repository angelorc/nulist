import type { AccessSettings } from '#shared/schemas/access'

export default defineInstanceAdminHandler((_event, { platform }): Promise<AccessSettings> =>
  platform.access.settings()
)
