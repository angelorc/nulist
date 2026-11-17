import { and, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { contacts } from '../../db/schema'
import { isSegmentGroup, segmentRulesSchema } from '../../../shared/schemas/segments'
import type {
  SegmentCondition,
  SegmentFieldType,
  SegmentNode,
  SegmentRules
} from '../../../shared/types/domain'
import { segmentFieldDefinition } from '../../../shared/utils/segments'
import { ValidationError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'
import { ActivityCompiler } from './conditions/ActivityCompiler'
import { AttributeCompiler } from './conditions/AttributeCompiler'
import type { ConditionCompiler } from './conditions/ConditionCompiler'
import { DateFieldCompiler } from './conditions/DateFieldCompiler'
import { EngagementCompiler } from './conditions/EngagementCompiler'
import { ListMembershipCompiler } from './conditions/ListMembershipCompiler'
import { SegmentMembershipCompiler } from './conditions/SegmentMembershipCompiler'
import { StatusFieldCompiler } from './conditions/StatusFieldCompiler'
import { TextFieldCompiler } from './conditions/TextFieldCompiler'
import { TopicCompiler } from './conditions/TopicCompiler'
import { SegmentCompileContext } from './SegmentCompileContext'
import type { SegmentRulesCompiler } from './SegmentCompileContext'

const DEFAULT_COMPILERS: ConditionCompiler[] = [
  new TextFieldCompiler(),
  new StatusFieldCompiler(),
  new DateFieldCompiler(),
  new ListMembershipCompiler(),
  new SegmentMembershipCompiler(),
  new TopicCompiler(),
  new ActivityCompiler(),
  new EngagementCompiler(),
  new AttributeCompiler()
]

/**
 * Compiles segment rules into one parameterized predicate over `contacts`.
 * Rules are re-validated with the shared zod schema first (stored JSON is not
 * trusted), then each condition is delegated to the compiler of its field type.
 * Works for one organization: segments and topics referenced by the rules are
 * loaded from it, and every predicate it returns is tenant-scoped by construction.
 */
export class SegmentQueryBuilder implements SegmentRulesCompiler {
  private readonly compilers = new Map<SegmentFieldType, ConditionCompiler>()

  constructor(
    private readonly scope: TenantScope,
    private readonly db: Database,
    compilers: ConditionCompiler[] = DEFAULT_COMPILERS
  ) {
    for (const compiler of compilers) this.compilers.set(compiler.type, compiler)
  }

  /**
   * Compiles rules into a parameterized WHERE condition over the `contacts` table,
   * restricted to the contacts of the organization (sub-selects over lists and email events too).
   */
  async build(rules: SegmentRules): Promise<SQL> {
    return this.compile(rules, await this.context([rules]))
  }

  async buildMany(ruleSets: readonly SegmentRules[]): Promise<(SQL | null)[]> {
    const context = await this.context(ruleSets)

    return ruleSets.map((rules) => {
      try {
        return this.compile(rules, context)
      } catch (error) {
        console.error('[segments] failed to compile segment rules', error)

        return null
      }
    })
  }

  async context(
    ruleSets: readonly SegmentRules[],
    overrides?: ReadonlyMap<string, SegmentRules>
  ): Promise<SegmentCompileContext> {
    return SegmentCompileContext.load(this.db, this.scope, ruleSets, this, overrides)
  }

  compile(rules: SegmentRules, context: SegmentCompileContext): SQL {
    const parsed = segmentRulesSchema.safeParse(rules)

    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid segment rules', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.map(String), message: i.message }))
      })
    }

    context.assertSize(parsed.data)

    const { match, conditions } = parsed.data
    const tenant = this.scope.eq(contacts.organizationId)

    if (!conditions.length) return tenant

    const predicates = conditions.map((node) => this.node(node, context))
    const matching = match === 'any' ? or(...predicates) : and(...predicates)

    return and(tenant, matching) ?? tenant
  }

  private node(node: SegmentNode, context: SegmentCompileContext): SQL {
    if (!isSegmentGroup(node)) return this.condition(node, context)

    const predicates = node.conditions.map((condition) => this.condition(condition, context))

    switch (node.match) {
      case 'all':
        return and(...predicates) ?? sql`true`
      case 'any':
        return or(...predicates) ?? sql`false`
      case 'none':
        return sql`not coalesce(${or(...predicates) ?? sql`false`}, false)`
    }
  }

  private condition(condition: SegmentCondition, context: SegmentCompileContext): SQL {
    const compiler = this.compilers.get(segmentFieldDefinition(condition.field).type)

    if (!compiler) throw new ValidationError(`Unsupported segment field "${condition.field}"`)

    return compiler.compile(condition, context)
  }
}
