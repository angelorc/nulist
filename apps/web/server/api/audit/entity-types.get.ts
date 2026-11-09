export default defineApiHandler(
  (_event, { services }): Promise<string[]> => services.logs.auditEntityTypes(),
  { permission: { audit: ['read'] } }
)
