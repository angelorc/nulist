export default defineApiHandler((_event, { services }) => services.broadcasts.options(), {
  permission: { broadcast: ['read'] }
})
