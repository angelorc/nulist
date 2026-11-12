import type { LintOptions } from '@templatical/quality'

/**
 * The visual editor's quality checks (its Issues tab). The preheader is edited
 * in the template toolbar, outside the editor document, so the editor's own
 * "missing preheader" hint would always fire.
 */
export const TEMPLATE_LINT_OPTIONS = {
  accessibility: { rules: { 'a11y.missing-preheader': 'off' } }
} satisfies LintOptions
