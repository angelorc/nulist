export default defineApiHandler((_event, { services }) => services.segments.list(), {
  permission: { segment: ['read'] }
})
