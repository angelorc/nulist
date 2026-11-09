import { SIMULATE_SES_EVENT_PERMISSION, simulateSesEventSchema } from '#shared/schemas/webhooks'

/**
 * Dev/demo helper: runs a realistic SES event for a message of the active
 * organization through the real pipeline. It really changes statuses and
 * suppresses addresses, hence the permission.
 */
export default defineApiHandler(
  async (event, { services, actor }) => {
    const body = await readValidatedBody(event, simulateSesEventSchema.parse)

    return services.sesSimulator.simulate(body, actor)
  },
  { permission: SIMULATE_SES_EVENT_PERMISSION }
)
