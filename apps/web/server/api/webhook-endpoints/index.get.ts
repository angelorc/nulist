export default defineApiHandler((_event, { services }) => services.webhookAdmin.listEndpoints(), {
  permission: { webhook: ['read'] }
})
