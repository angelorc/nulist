import { and, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { contacts } from '../../db/schema'
import { segmentRulesSchema } from '../../../shared/schemas/segments'
import type { SegmentCondition, SegmentFieldType, SegmentRules } from '../../../shared/types/domain'
import { segmentFieldDefinition } from '../../../shared/utils/segments'
import { ValidationError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'
import { AttributeCompiler } from './conditions/AttributeCompiler'
import type { ConditionCompiler } from './conditions/ConditionCompiler'
import { DateFieldCompiler } from './conditions/DateFieldCompiler'
import { EngagementCompiler } from './conditions/EngagementCompiler'
import { ListMembershipCompiler } from './conditions/ListMembershipCompiler'
import { StatusFieldCompiler } from './conditions/StatusFieldCompiler'
import { TextFieldCompiler } from './conditions/TextFieldCompiler'

const DEFAULT_COMPILERS: ConditionCompiler[] = [
  new TextFieldCompiler(),
  new StatusFieldCompiler(),
  new DateFieldCompiler(),
  new ListMembershipCompiler(),
  new EngagementCompiler(),
  new AttributeCompiler()
]

/**
 * Compiles segment rules into one parameterized predicate over `contacts`.
 * Rules are re-validated with the shared zod schema first (stored JSON is not
 * trusted), then each condition is delegated to the compiler of its field type.
 * Stateless and shared by an organization's services; the organization is passed
 * to `build`, so every predicate it returns is tenant-scoped by construction.
 */
export class SegmentQueryBuilder {
  private readonly compilers = new Map<SegmentFieldType, ConditionCompiler>()

  constructor(compilers: ConditionCompiler[] = DEFAULT_COMPILERS) {
    for (const compiler of compilers) this.compilers.set(compiler.type, compiler)
  }

  /**
   * Compiles rules into a parameterized WHERE condition over the `contacts` table,
   * restricted to the contacts of `scope` (sub-selects over lists and email events too).
   */
  build(rules: SegmentRules, scope: TenantScope): SQL {
    const parsed = segmentRulesSchema.safeParse(rules)

    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid segment rules', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.map(String), message: i.message }))
      })
    }

    const { match, conditions } = parsed.data
    const tenant = scope.eq(contacts.organizationId)

    if (!conditions.length) return tenant

    const predicates = conditions.map((condition) => this.compile(condition, scope))
    const matching = match === 'any' ? or(...predicates) : and(...predicates)

    return and(tenant, matching) ?? tenant
  }

  private compile(condition: SegmentCondition, scope: TenantScope): SQL {
    const compiler = this.compilers.get(segmentFieldDefinition(condition.field).type)

    if (!compiler) throw new ValidationError(`Unsupported segment field "${condition.field}"`)

    return compiler.compile(condition, scope)
  }
}
