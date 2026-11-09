import { V1_PERMISSIONS, v1BroadcastSendSchema, v1IdParamsSchema } from '#shared/schemas/v1'

/** POST /api/v1/broadcasts/{id}/send — send a draft now, or schedule it with `scheduledAt`. */
export default defineApiKeyHandler(
  async (event, { services, actor }) => {
    const { id } = await getValidatedRouterParams(event, v1IdParamsSchema.parse)
    const { scheduledAt } = await readValidatedBody(event, v1BroadcastSendSchema.parse)

    const broadcast = await services.broadcastApi.send(
      id,
      scheduledAt ? new Date(scheduledAt) : null,
      actor
    )

    setResponseStatus(event, 202)

    return broadcast
  },
  { permission: V1_PERMISSIONS.sendBroadcast }
)
