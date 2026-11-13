import { and, asc, eq, sql } from 'drizzle-orm'
import type { Database, Executor } from '../../db/client'
import { savedColors } from '../../db/schema'
import { SAVED_COLOR_LIMIT } from '../../../shared/schemas/saved-colors'
import { ConflictError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'

/**
 * Colours an organization saved from the visual editor's colour picker, offered
 * in every picker of every template. Colours arrive normalized by
 * `savedColorSchema` (`#rrggbb`), so one colour is saved once.
 */
export class SavedColorService {
  constructor(
    private readonly scope: TenantScope,
    private readonly db: Database,
    private readonly limit = SAVED_COLOR_LIMIT
  ) {}

  /** Oldest first, so a saved colour keeps its place in the row. */
  async list(): Promise<string[]> {
    return this.listWith(this.db)
  }

  /** Saves `color` (saving it again changes nothing) and returns the saved colours. */
  async add(color: string): Promise<string[]> {
    return this.db.transaction(async (tx) => {
      // Two members saving at once could otherwise both pass the limit check.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`saved-colors:${this.scope.organizationId}`}, 0))`
      )
      const saved = await this.listWith(tx)

      if (saved.includes(color)) return saved

      if (saved.length >= this.limit) {
        throw new ConflictError(
          `You can save up to ${this.limit} colors. Remove one to save another.`,
          'saved_colors_full',
          { limit: this.limit }
        )
      }

      await tx.insert(savedColors).values(this.scope.values({ color }))

      return [...saved, color]
    })
  }

  /** Removes `color` (not saved: nothing changes) and returns the saved colours. */
  async remove(color: string): Promise<string[]> {
    await this.db
      .delete(savedColors)
      .where(and(this.scope.eq(savedColors.organizationId), eq(savedColors.color, color)))

    return this.list()
  }

  private async listWith(executor: Executor): Promise<string[]> {
    const rows = await executor
      .select({ color: savedColors.color })
      .from(savedColors)
      .where(this.scope.eq(savedColors.organizationId))
      .orderBy(asc(savedColors.createdAt), asc(savedColors.color))

    return rows.map((row) => row.color)
  }
}
