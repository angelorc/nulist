// https://nuxt.com/docs/api/configuration/nuxt-config
import { createRequire } from 'node:module'

/**
 * `@workflow/nitro` augments nitropack's NitroOptions with `workflow`, but that augmentation is not
 * part of this config's type program, so the option is declared here and spread into `nitro`.
 */
interface WorkflowNitroOptions {
  workflow: { dirs: string[] }
}

const workflowNitroOptions: WorkflowNitroOptions = { workflow: { dirs: ['server/workflows'] } }

/**
 * The workflow runtime imports WORKFLOW_TARGET_WORLD by name, so Nitro's tracer cannot see it.
 * `traceInclude` takes file paths, hence the resolved entry instead of the package name.
 */
const workflowWorldEntry = createRequire(import.meta.url).resolve('@workflow/world-postgres')

export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@vueuse/nuxt', '@nuxtjs/better-auth', 'workflow/nuxt'],

  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    // Server configuration is read from the environment by server/lib/core/config.ts
    // (shared with workflow steps, which cannot use useRuntimeConfig).
    public: {
      /** Public base URL: Better Auth base URL and recipient-facing links (NUXT_PUBLIC_SITE_URL). */
      siteUrl: 'http://localhost:3000'
    }
  },

  auth: {
    redirects: { login: '/login', guest: '/' }
  },

  routeRules: {
    '/**': { auth: 'user' },
    '/login': { auth: 'guest' },
    '/setup': { auth: 'guest' },
    // Recipient-facing pages
    '/u/**': { auth: false },
    '/preferences/**': { auth: false },
    '/confirm/**': { auth: false },
    '/subscribe/**': { auth: false },
    '/view/**': { auth: false },
    // Invitees may be signed out (sign in or sign up from the invitation page)
    '/invitations/**': { auth: false },
    // Instance administration (organizations, limits)
    '/admin/**': { auth: { only: 'user', user: { role: 'admin' } } },
    '/settings/access': { auth: { only: 'user', user: { role: 'admin' } } },
    '/api/admin/**': { auth: { only: 'user', user: { role: 'admin' } } },
    '/settings/team': { redirect: '/settings/members' },
    // Invitation details are public; the other invitation endpoints check the session themselves
    '/api/invitations/**': { auth: false },
    // Machine endpoints authenticate on their own (API keys, SNS signatures, workflow runtime)
    '/api/v1/**': { auth: false, cors: true },
    '/api/public/**': { auth: false },
    '/api/webhooks/**': { auth: false },
    '/api/setup': { auth: false },
    '/.well-known/**': { auth: false },
    '/_workflow/**': { auth: false }
  },

  compatibilityDate: '2026-06-30',

  nitro: {
    experimental: { asyncContext: true },
    externals: { traceInclude: [workflowWorldEntry] },
    // Read by @workflow/nitro: only scan our workflow directory for directives.
    ...workflowNitroOptions
  },

  vite: {
    optimizeDeps: {
      include: [
        '@templatical/editor',
        '@templatical/import-mjml',
        'vue-codemirror',
        'codemirror',
        '@codemirror/lang-html',
        'papaparse',
        'date-fns'
      ]
    }
  },

  icon: {
    clientBundle: { scan: true }
  }
})
