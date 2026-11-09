export default defineApiHandler((_event, { services }) => services.topics.listWithStats(), {
  permission: { topic: ['read'] }
})
