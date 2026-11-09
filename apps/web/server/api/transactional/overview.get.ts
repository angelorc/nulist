/**
 * Transactional dashboard of the active organization: status counts (24h / 7d),
 * recent emails, templates and REST API traffic.
 */
export default defineApiHandler(
  async (_event, { services }) => {
    const [overview, api] = await Promise.all([
      services.transactional.overview(),
      services.apiLogs.summary(new Date(Date.now() - 86_400_000))
    ])

    return { ...overview, api }
  },
  { permission: { transactional: ['read'] } }
)
