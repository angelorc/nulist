import { apiKeyClient } from '@better-auth/api-key/client'
import { defineClientAuth } from '@nuxtjs/better-auth/config'
import { adminClient, organizationClient } from 'better-auth/client/plugins'
import { ac, roles } from '#shared/auth/permissions'

/** Keep plugins in sync with server/auth.config.ts. */
export default defineClientAuth({
  plugins: [adminClient(), organizationClient({ ac, roles }), apiKeyClient()]
})
