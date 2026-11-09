import { z } from 'zod'
import { ACTIVE_ORGANIZATION_HEADER, ORGANIZATION_CHANGED } from '#shared/schemas/organization'

/** Same-origin API paths (other requests never carry the organization). */
const apiPathSchema = z.string().startsWith('/api/')

/** The h3 error body of a 409 `organization_changed`. */
const organizationChangedSchema = z.object({
  data: z.object({ code: z.literal(ORGANIZATION_CHANGED) })
})

/**
 * Tells the server which organization this tab works in. When another tab
 * switched the session to a different organization, dashboard calls from this
 * tab fail with 409 `organization_changed` (instead of reading or writing the
 * other organization's data) until the page is reloaded.
 */
export default defineNuxtPlugin(() => {
  const { organization } = useOrganization()
  const toast = useToast()

  globalThis.$fetch = $fetch.create({
    onRequest({ request, options }) {
      const organizationId = organization.value?.id

      if (organizationId && apiPathSchema.safeParse(request).success)
        options.headers.set(ACTIVE_ORGANIZATION_HEADER, organizationId)
    },
    onResponseError({ response }) {
      if (response.status !== 409 || !organizationChangedSchema.safeParse(response._data).success)
        return

      toast.add({
        id: ORGANIZATION_CHANGED,
        title: 'Organization changed in another tab',
        description: 'Reload this page to continue in the organization that is now active.',
        color: 'warning',
        icon: 'i-lucide-building-2',
        duration: 0,
        actions: [
          { label: 'Reload', color: 'neutral', variant: 'outline', onClick: () => reloadNuxtApp() }
        ]
      })
    }
  })
})
