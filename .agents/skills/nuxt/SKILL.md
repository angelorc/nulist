---
name: "nuxt"
description: "Use before changing Nuxt code. Routes to the smallest relevant guide for `useFetch`/`useAsyncData`, SSR and hydration, `definePageMeta`/`useSeoMeta`, `runtimeConfig`, Nitro server routes, plugins, errors, Nuxt UI, Nuxt Content, installed Nuxt modules, or module authoring."
---

# Nuxt Skill Router

Decide what Nuxt owns before editing, then open the smallest relevant Nuxt, Vue, or module guide.

## Loading rules
1. Repository-global instructions and required workflows win first.
2. Inspect the exact surface you are changing: page, layout, component, composable, server handler, plugin, config file, or module-owned file.
3. If a generic Vue or raw HTML fix looks plausible, read [Abstraction Disambiguation](./references/nuxt/rules/abstraction-disambiguation.md) first. Most Nuxt mistakes are the right behavior built on the wrong primitive.
4. Switch to [Vue Best Practices](./references/vue/SKILL.md) only when Nuxt no longer owns the abstraction.
5. Use module guides only for module-owned APIs, config, runtime behavior, and files.

## Routing
Open one guide that matches the task. Open more only when that guide points you there or the task clearly crosses boundaries.

| Task shape or symptom | Example request | Open first |
| --- | --- | --- |
| Writing or refactoring a Nuxt module (`defineNuxtModule`, hooks, public APIs) | "Add a Nuxt module option, hook, or runtime extension" | [Module Authoring Conventions](./references/nuxt/rules/module-authoring.md) |
| Tables, forms, modals, dropdowns, page shells, or other UI that Nuxt UI already ships | "This modal/table/dropdown was hand-built in raw HTML" | [Nuxt UI Primitives](./references/nuxt/rules/nuxt-ui-primitives.md) |
| Nuxt Content collections, structured data records, or navigation built from content | "Build the docs sidebar from the content folder" | [Content Modeling and Navigation](./references/nuxt/rules/content-modeling-navigation.md) |
| SSR, initial page load, route params, or data fetched for first render | "This page fetches twice on first load" | [Data Fetching and SSR](./references/nuxt/rules/data-fetching-ssr.md) |
| Hydration warnings, `ClientOnly`, browser-only APIs, time/randomness, or SSR/CSR mismatch | "Why do I get a hydration mismatch from Date.now()?" | [Hydration and SSR Consistency](./references/nuxt/rules/hydration-consistency.md) |
| Page options, middleware, layout selection, title, meta tags, canonical URLs, or OG data | "Change canonical URL and OG tags" | [Page Meta, Head, and Layout](./references/nuxt/rules/page-meta-head-layout.md) |
| Global/local errors, `clearError`, `showError`, or recovery flows | "`clearError` is not behaving as expected" | [Error Surfaces and Recovery](./references/nuxt/rules/error-surfaces-recovery.md) |
| `nuxt.config.*`, `runtimeConfig`, env wiring, or public/private config exposure | "Expose only the public runtimeConfig key" | [Server Routes, h3 Patterns, and Runtime Config](./references/nuxt/rules/server-routes-runtime-config.md) |
| `server/api/**`, `server/routes/**`, `defineEventHandler`, route rules, caching, or Nitro plugins | "This server/api handler cache or route rule is wrong" | [Nitro and h3 Server Patterns](./references/nuxt/rules/nitro-h3-patterns.md) |
| Secrets, privileged API calls, request isolation, or server/client boundary confusion | "Should this secret live in runtime config or client code?" | [Architecture Boundaries](./references/nuxt/rules/architecture-boundaries.md) |
| Plugins, injections, app boot logic, or global runtime initialization | "Register a global helper when the app starts" | [Plugins and Runtime Boot](./references/nuxt/rules/plugins.md) |
| Performance regressions, rendering strategy, lazy loading, or payload/bundle cost | "This page ships too much JavaScript" | [Performance and Rendering](./references/nuxt/rules/performance-rendering.md) |
| Upgrades, deprecations, compatibility fixes, or version-boundary work | "Upgrade this app from Nuxt 3 to Nuxt 4" | [Migrations and Compatibility](./references/nuxt/rules/migrations.md) |
| The remaining work is components, composables, reactivity, props/emits, or SFC structure | "Split this component and keep the props typed" | [Vue Best Practices](./references/vue/SKILL.md) |

## Project-specific guidance
This hosted skill covers Nuxt itself. Module APIs (Nuxt UI, Nuxt Content, NuxtHub, and others) change between versions, so check the installed module's docs before relying on exact props or options.

For guidance that matches the modules and versions installed in a project, add the Nuxt module there:

```bash
npx nuxi module add nuxt-skill-hub
```

`nuxt prepare` then writes a local skill that also includes each installed module's skill.

## Finish
Before concluding a change that touches more than one surface, read [Verification and Finish](./references/nuxt/rules/verification-finish.md).

- Check paired surfaces: page and head, server and client, global and local errors.
- Verify framework behavior, not only visible output.
- Keep module guidance scoped to the owning module.

---

_Generated by nuxt-skill-hub. Do not edit this file manually._
