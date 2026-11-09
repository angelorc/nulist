import type { StorageStatus } from '#shared/schemas/files'

/** The organization's storage health, usage and limits. */
export default defineApiHandler(
  async (_event, { services }): Promise<StorageStatus> => {
    const [health, usage, limits] = await Promise.all([
      services.files.health(),
      services.files.usage(),
      services.settings.get('limits')
    ])

    return {
      ...health,
      ...usage,
      maxFileSizeMb: limits.maxFileSizeMb,
      maxStorageMb: limits.maxStorageMb
    }
  },
  { permission: { file: ['read'] } }
)
