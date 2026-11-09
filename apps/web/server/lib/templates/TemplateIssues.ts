import type { TemplateIssue } from '../../../shared/schemas/templates'
import type { MjmlIssue } from './TemplateRenderer'

const LIQUID_LINE = /line:(\d+)/

/** Normalises MJML validation output and Liquid errors into editor issues. */
export class TemplateIssues {
  static fromMjml(issues: MjmlIssue[]): TemplateIssue[] {
    return issues.map((issue) => ({
      source: 'mjml',
      line: Number.isFinite(issue.line) ? issue.line : null,
      message: issue.message,
      tagName: issue.tagName
    }))
  }

  /** A caught Liquid parse or render error (liquidjs messages carry `line:N`). */
  static fromLiquid(cause: unknown): TemplateIssue {
    const message = cause instanceof Error ? cause.message : String(cause)
    const line = LIQUID_LINE.exec(message)?.[1]

    return { source: 'liquid', line: line ? Number(line) : null, message }
  }
}
