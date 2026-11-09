import { count } from 'drizzle-orm'
import { user } from '../db/schema'

/** First-run detection: the setup page is only usable while no user exists (instance-wide). */
export default definePublicHandler(async (_event, { platform }) => {
  const [row] = await platform.db.select({ value: count() }).from(user)

  return { needsSetup: (row?.value ?? 0) === 0 }
})
