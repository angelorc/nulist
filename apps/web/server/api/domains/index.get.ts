/** Sending context plus the active organization's SES identities (empty without SES API credentials). */
export default defineApiHandler((_event, { services }) => services.domains.overview(), {
  permission: { domain: ['read'] }
})
