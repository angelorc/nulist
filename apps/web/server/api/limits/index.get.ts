/** Usage of the active organization against each of its limits (0 = no limit). */
export default defineApiHandler((_event, { services }) => services.limits.usage(), {
  permission: { settings: ['read'] }
})
