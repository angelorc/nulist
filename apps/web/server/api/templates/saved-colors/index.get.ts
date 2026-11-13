/** Colours the organization saved from the visual editor's colour picker, oldest first. */
export default defineApiHandler((_event, { services }) => services.savedColors.list(), {
  permission: { template: ['read'] }
})
