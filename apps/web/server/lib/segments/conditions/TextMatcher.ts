import { ilike, notIlike, sql } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'
import type { SegmentOperator } from '../../../../shared/types/domain'
import { escapeLike } from '../../core/sql'

export type TextOperator = Extract<
  SegmentOperator,
  'eq' | 'neq' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'is_set' | 'is_not_set'
>

const TEXT_OPERATORS: ReadonlySet<SegmentOperator> = new Set<TextOperator>([
  'eq',
  'neq',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'is_set',
  'is_not_set'
])

/**
 * Case-insensitive text predicates over any text expression (a column or
 * `attributes ->> key`). Equality uses ILIKE with escaped wildcards, so
 * user input is always a literal, bound parameter.
 * Negative operators treat NULL as "does not match the value".
 */
export class TextMatcher {
  constructor(private readonly expression: AnyColumn | SQL) {}

  static supports(operator: SegmentOperator): operator is TextOperator {
    return TEXT_OPERATORS.has(operator)
  }

  match(operator: TextOperator, value: string): SQL {
    const expr = this.expression
    const literal = escapeLike(value)

    switch (operator) {
      case 'eq':
        return ilike(expr, literal)
      case 'neq':
        return notIlike(sql`coalesce(${expr}, '')`, literal)
      case 'contains':
        return ilike(expr, `%${literal}%`)
      case 'not_contains':
        return notIlike(sql`coalesce(${expr}, '')`, `%${literal}%`)
      case 'starts_with':
        return ilike(expr, `${literal}%`)
      case 'ends_with':
        return ilike(expr, `%${literal}`)
      case 'is_set':
        return sql`coalesce(${expr}, '') <> ''`
      case 'is_not_set':
        return sql`coalesce(${expr}, '') = ''`
    }
  }
}
