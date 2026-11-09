export default defineApiHandler((_event, { services }) => services.lists.list(), {
  permission: { list: ['read'] }
})
