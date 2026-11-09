/**
 * Starts the Workflow SDK Postgres world (graphile-worker queue) inside this
 * server process when it is the configured target world.
 */
export default defineNitroPlugin(async () => {
  if (process.env.WORKFLOW_TARGET_WORLD !== '@workflow/world-postgres') return
  const { getWorld } = await import('workflow/runtime')
  const world = await getWorld()
  await world.start?.()
})
