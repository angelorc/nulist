export default defineApiHandler((_event, { services }) => services.broadcasts.tabCounts(), {
  permission: { broadcast: ['read'] }
})
