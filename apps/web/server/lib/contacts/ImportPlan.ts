import { coerceAttributeValue, contactEmailSchema } from '../../../shared/schemas/contacts'
import { ATTRIBUTE_TARGET_PREFIX, isImportTarget } from '../../../shared/schemas/imports'
import type { ImportTarget } from '../../../shared/schemas/imports'
import type { AttributeValue, ImportSubscriptionStatus } from '../../../shared/types/contacts'
import type { ImportMapping, ImportRowError } from '../../../shared/types/domain'
import { ValidationError } from '../core/errors'

export interface MappedImportRow {
  row: number
  email: string
  /** `undefined` = leave untouched, `null` = clear (overwrite mode only). */
  firstName: string | null | undefined
  lastName: string | null | undefined
  attributes: Record<string, AttributeValue>
}

export type RowMapping = { ok: true; value: MappedImportRow } | { ok: false; error: ImportRowError }

/** How CSV columns become contact fields, plus the options chosen for the import. */
export class ImportPlan {
  private constructor(
    private readonly columns: ReadonlyMap<string, ImportTarget>,
    readonly subscription: ImportSubscriptionStatus
  ) {}

  static create(mapping: ImportMapping, subscription: ImportSubscriptionStatus): ImportPlan {
    const columns = new Map<string, ImportTarget>()

    for (const [column, target] of Object.entries(mapping)) {
      if (target === 'ignore') continue

      if (!isImportTarget(target))
        throw new ValidationError(`Column "${column}" is mapped to an unknown field`)
      columns.set(column, target)
    }

    const plan = new ImportPlan(columns, subscription)

    if (!plan.emailColumn) throw new ValidationError('Map one column to Email')

    return plan
  }

  /** Rebuilds the plan from `imports.mapping` and `imports.subscription`. */
  static fromStored(record: {
    mapping: ImportMapping
    subscription: ImportSubscriptionStatus
  }): ImportPlan {
    return ImportPlan.create(record.mapping, record.subscription)
  }

  /** Column → target pairs as chosen by the user (ignored columns omitted). */
  mapping(): ImportMapping {
    return Object.fromEntries(this.columns)
  }

  get emailColumn(): string {
    for (const [column, target] of this.columns) if (target === 'email') return column

    return ''
  }

  /** True when at least one column feeds a custom attribute. */
  get mapsAttributes(): boolean {
    for (const target of this.columns.values())
      if (target.startsWith(ATTRIBUTE_TARGET_PREFIX)) return true

    return false
  }

  missingColumns(headers: string[]): string[] {
    const available = new Set(headers)

    return [...this.columns.keys()].filter((column) => !available.has(column))
  }

  /** Keeps only the non-empty mapped columns so staged rows stay small. */
  pick(record: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      [...this.columns.keys()].flatMap((column) => {
        const value = record[column]

        return value ? [[column, value]] : []
      })
    )
  }

  normalizedEmail(record: Record<string, string>): string {
    return (record[this.emailColumn] ?? '').trim().toLowerCase()
  }

  /**
   * Maps one staged row. Empty cells never overwrite data in merge mode;
   * in overwrite mode an empty mapped name clears the stored value.
   */
  map(row: number, record: Record<string, string>, overwrite: boolean): RowMapping {
    const raw = (record[this.emailColumn] ?? '').trim()

    if (!raw) return { ok: false, error: { row, message: 'Missing email address' } }
    const email = contactEmailSchema.safeParse(raw)

    if (!email.success)
      return {
        ok: false,
        error: { row, email: raw.slice(0, 254), message: 'Invalid email address' }
      }

    const value: MappedImportRow = {
      row,
      email: email.data,
      firstName: undefined,
      lastName: undefined,
      attributes: {}
    }

    for (const [column, target] of this.columns) {
      const cell = (record[column] ?? '').trim()

      if (target === 'first_name' || target === 'last_name') {
        const name = cell ? cell.slice(0, 100) : overwrite ? null : undefined

        if (target === 'first_name') value.firstName = name
        else value.lastName = name
      } else if (target.startsWith(ATTRIBUTE_TARGET_PREFIX) && cell) {
        value.attributes[target.slice(ATTRIBUTE_TARGET_PREFIX.length)] = coerceAttributeValue(
          cell.slice(0, 2000)
        )
      }
    }

    return { ok: true, value }
  }
}
