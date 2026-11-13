import { and, count, desc, eq, ilike, inArray, ne, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { z } from 'zod'
import type { Database } from '../../db/client'
import { broadcasts, templates } from '../../db/schema'
import { MAX_MJML, MjmlFormatter } from '../../../shared/schemas/templates'
import { TemplateDesignEnvelope } from '../../../shared/schemas/template-design'
import type {
  TemplateCreateInput,
  TemplateDesign,
  TemplateIssue,
  TemplateListQuery,
  TemplateUpdateInput
} from '../../../shared/schemas/templates'
import type { Actor } from '../core/actor'
import { ConflictError, InvalidStateError, NotFoundError, ValidationError } from '../core/errors'
import { AuditLogger } from '../audit/AuditLogger'
import type { AuditFieldChange } from '../audit/AuditLogger'
import type { LimitService } from '../limits/LimitService'
import { TemplateIssues } from './TemplateIssues'
import type { TemplateRenderer } from './TemplateRenderer'
import type { TemplateDesignRenderer } from './TemplateDesignRenderer'
import type { StarterCatalog } from './starters/StarterCatalog'
import { containsPattern, escapeLike } from '../core/sql'
import type { TenantScope } from '../core/TenantScope'

export type TemplateRow = typeof templates.$inferSelect

/** Columns an update may change (the owning organization never changes). */
type TemplatePatch = Partial<Omit<typeof templates.$inferInsert, 'id' | 'organizationId'>>

/** List projection: everything except the (large) content columns and the owning organization. */
export type TemplateSummary = Omit<TemplateRow, 'organizationId' | 'mjml' | 'design' | 'html'>

export interface TemplateWithHtml extends TemplateSummary {
  html: string
}

/** A saved template plus non-blocking MJML validation warnings. */
export interface SavedTemplate extends TemplateRow {
  warnings: TemplateIssue[]
}

export interface CompiledTemplate {
  html: string
  warnings: TemplateIssue[]
}

/** Content a create may set directly (REST API); without `mjml` the starter layout is used. */
export interface TemplateInitialContent {
  mjml?: string
  preheader?: string | null
}

const SUMMARY_COLUMNS = {
  id: templates.id,
  name: templates.name,
  slug: templates.slug,
  kind: templates.kind,
  editor: templates.editor,
  subject: templates.subject,
  preheader: templates.preheader,
  createdAt: templates.createdAt,
  updatedAt: templates.updatedAt
}

/** Fields compared in audit diffs (content columns are summarised, not diffed). */
type AuditedFields = Pick<
  TemplateRow,
  'name' | 'slug' | 'kind' | 'editor' | 'subject' | 'preheader'
>

/** Audit `changes` of an update: field diffs plus `content: 'updated'` for MJML edits. */
interface TemplateChanges {
  [field: string]: AuditFieldChange | 'updated'
}

function auditedFields(row: TemplateRow): AuditedFields {
  return {
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    editor: row.editor,
    subject: row.subject,
    preheader: row.preheader
  }
}

/** Broadcast states in which a template is still going to be rendered. */
const ACTIVE_BROADCAST_STATUSES = ['scheduled', 'sending', 'paused'] as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Postgres error code, on the driver error or on drizzle's wrapping `DrizzleQueryError.cause`. */
const pgErrorSchema = z.object({
  code: z.string().optional(),
  cause: z.object({ code: z.string().optional() }).optional()
})

/** True for a unique violation (the per-organization `templates_org_slug_uq`). */
function isUniqueViolation(cause: unknown): boolean {
  const parsed = pgErrorSchema.safeParse(cause)

  return parsed.success && (parsed.data.code === '23505' || parsed.data.cause?.code === '23505')
}

/** The stored content of a template: MJML plus, for the visual editor, its design. */
interface TemplateSource {
  mjml: string
  design: TemplateRow['design']
}

/**
 * Email templates (MJML + Liquid) of one organization. MJML is what is
 * compiled and sent; the compiled HTML is cached in `html`. A visual template
 * also keeps its editor document in `design`, and its MJML is always rendered
 * from that document here, so the two never disagree. Slugs are unique per
 * organization, and a template of another organization behaves exactly like a
 * missing one (404).
 */
export class TemplateService {
  private readonly formatter = new MjmlFormatter()

  constructor(
    protected readonly scope: TenantScope,
    protected readonly db: Database,
    protected readonly renderer: TemplateRenderer,
    protected readonly audit: AuditLogger,
    protected readonly limits: LimitService,
    protected readonly designs: TemplateDesignRenderer,
    protected readonly starters: StarterCatalog
  ) {}

  // Queries ------------------------------------------------------------------

  /** `organization_id = <scope> AND <conditions>`: the base of every templates query. */
  private scoped(...conditions: (SQL | undefined)[]): SQL | undefined {
    return and(this.scope.eq(templates.organizationId), ...conditions)
  }

  private filters(query: Pick<TemplateListQuery, 'kind' | 'q'>) {
    const q = query.q?.trim()

    return this.scoped(
      query.kind ? eq(templates.kind, query.kind) : undefined,
      q
        ? or(
            ilike(templates.name, containsPattern(q)),
            ilike(templates.slug, containsPattern(q)),
            ilike(templates.subject, containsPattern(q))
          )
        : undefined
    )
  }

  async list(query: Pick<TemplateListQuery, 'kind' | 'q'> = {}): Promise<TemplateSummary[]> {
    return this.db
      .select(SUMMARY_COLUMNS)
      .from(templates)
      .where(this.filters(query))
      .orderBy(desc(templates.updatedAt))
  }

  /** Like `list` but with compiled HTML (thumbnails). */
  async listWithHtml(
    query: Pick<TemplateListQuery, 'kind' | 'q'> = {}
  ): Promise<TemplateWithHtml[]> {
    const rows = await this.db
      .select()
      .from(templates)
      .where(this.filters(query))
      .orderBy(desc(templates.updatedAt))

    return Promise.all(
      rows.map(async (row) => {
        const { organizationId: _organizationId, mjml: _mjml, design: _design, ...summary } = row

        return Object.assign(summary, { html: await this.compiledHtml(row) })
      })
    )
  }

  async findOrFail(id: string): Promise<TemplateRow> {
    const [row] = await this.db
      .select()
      .from(templates)
      .where(this.scoped(eq(templates.id, id)))

    if (!row) throw new NotFoundError('Template', id)

    return row
  }

  async get(id: string): Promise<TemplateRow> {
    return this.findOrFail(id)
  }

  /** Resolve by id or slug within the organization (transactional API). */
  async findByRef(ref: string): Promise<TemplateRow> {
    const value = ref.trim()

    const match = UUID.test(value)
      ? eq(templates.id, value)
      : eq(templates.slug, value.toLowerCase())

    const [row] = await this.db.select().from(templates).where(this.scoped(match))

    if (!row) throw new NotFoundError('Template', value)

    return row
  }

  /** Compiled HTML for sending (uses cached `html`, compiles MJML when missing). */
  async compiledHtml(template: TemplateRow): Promise<string> {
    if (template.html) return template.html
    const { html } = await this.renderer.compileMjml(template.mjml)
    await this.db
      .update(templates)
      .set({ html, updatedAt: template.updatedAt })
      .where(this.scoped(eq(templates.id, template.id)))

    return html
  }

  /** Compiles MJML and validates the Liquid it contains. */
  async compile(mjml: string): Promise<CompiledTemplate> {
    this.renderer.assertLiquid(mjml, 'content')
    const { html, issues } = await this.renderer.compileMjml(mjml)

    return { html, warnings: TemplateIssues.fromMjml(issues) }
  }

  // Mutations ----------------------------------------------------------------

  async create(
    input: TemplateCreateInput & TemplateInitialContent,
    actor: Actor
  ): Promise<SavedTemplate> {
    await this.limits.assertCanCreate('templates')
    const slug = this.slugFor(input.kind, input.slug)

    if (slug) await this.assertSlugAvailable(slug)

    // A starter brings a suggested subject and preheader; the creator's own win.
    const starter =
      input.mjml === undefined ? this.starters.resolve(input.starter, input.kind) : null

    const subject = input.subject ?? starter?.subject ?? ''
    const preheader = input.preheader === undefined ? starter?.preheader : input.preheader

    this.renderer.assertLiquid(subject, 'subject')

    if (preheader) this.renderer.assertLiquid(preheader, 'preheader')

    const source = starter
      ? await this.fromDesign(TemplateDesignEnvelope.wrap(starter.build(input.kind)), input.editor)
      : { mjml: this.source(input.mjml ?? '', input.editor), design: null }

    const { html, warnings } = await this.compile(source.mjml)

    const row = await this.insert({
      name: input.name,
      slug,
      kind: input.kind,
      editor: input.editor,
      subject,
      preheader: preheader || null,
      mjml: source.mjml,
      design: source.design,
      html
    })

    await this.audit.log(actor, {
      action: 'template.created',
      entityType: 'template',
      entityId: row.id,
      summary: `Created ${row.kind} template "${row.name}"`
    })

    return { ...row, warnings }
  }

  async update(id: string, input: TemplateUpdateInput, actor: Actor): Promise<SavedTemplate> {
    const before = await this.findOrFail(id)
    const kind = input.kind ?? before.kind
    const editor = input.editor ?? before.editor
    const slug = this.slugFor(kind, input.slug === undefined ? before.slug : input.slug)

    if (slug && slug !== before.slug) await this.assertSlugAvailable(slug, id)

    if (input.subject !== undefined) this.renderer.assertLiquid(input.subject, 'subject')

    if (input.preheader) this.renderer.assertLiquid(input.preheader, 'preheader')

    const patch: TemplatePatch = { kind, editor, slug }

    if (input.name !== undefined) patch.name = input.name

    if (input.subject !== undefined) patch.subject = input.subject

    if (input.preheader !== undefined) patch.preheader = input.preheader || null

    let warnings: TemplateIssue[] = []

    // A visual-editor design is the source: its MJML is rendered here, never taken from the client.
    const designed =
      input.design && TemplateDesignEnvelope.isTemplatical(input.design)
        ? await this.fromDesign(input.design, 'visual')
        : null

    const mjml =
      designed?.mjml ?? (input.mjml === undefined ? undefined : this.source(input.mjml, editor))

    const contentChanged = mjml !== undefined && mjml !== before.mjml

    if (mjml !== undefined) {
      const compiled = await this.compile(mjml)
      patch.mjml = mjml
      patch.html = compiled.html
      warnings = compiled.warnings
      // A design describes a specific MJML document: drop it when MJML changes without it.
      patch.design =
        input.design === undefined ? (contentChanged ? null : before.design) : input.design
    } else if (input.design !== undefined) {
      patch.design = input.design
    }

    const row = await this.persist(id, patch)

    const changes: TemplateChanges = AuditLogger.diff(auditedFields(before), auditedFields(row))

    if (contentChanged) changes.content = 'updated'

    if (Object.keys(changes).length) {
      await this.audit.log(actor, {
        action: 'template.updated',
        entityType: 'template',
        entityId: id,
        summary: `Updated template "${row.name}"`,
        changes
      })
    }

    return { ...row, warnings }
  }

  async duplicate(id: string, actor: Actor): Promise<TemplateRow> {
    const source = await this.findOrFail(id)
    await this.limits.assertCanCreate('templates')
    const slug = source.slug ? await this.nextFreeSlug(`${source.slug}-copy`) : null

    const row = await this.insert({
      name: `${source.name} (copy)`.slice(0, 120),
      slug: source.kind === 'transactional' ? slug : null,
      kind: source.kind,
      editor: source.editor,
      subject: source.subject,
      preheader: source.preheader,
      mjml: source.mjml,
      design: source.design,
      html: source.html
    })

    await this.audit.log(actor, {
      action: 'template.duplicated',
      entityType: 'template',
      entityId: row.id,
      summary: `Duplicated template "${source.name}" as "${row.name}"`,
      changes: { sourceId: source.id }
    })

    return row
  }

  async delete(id: string, actor: Actor): Promise<void> {
    const template = await this.findOrFail(id)

    const [inUse] = await this.db
      .select({ value: count() })
      .from(broadcasts)
      .where(
        and(
          this.scope.eq(broadcasts.organizationId),
          eq(broadcasts.templateId, id),
          inArray(broadcasts.status, [...ACTIVE_BROADCAST_STATUSES])
        )
      )

    if (inUse?.value) {
      throw new InvalidStateError(
        `"${template.name}" is used by ${inUse.value} scheduled or sending broadcast${inUse.value === 1 ? '' : 's'}. Cancel them or pick another template first.`
      )
    }

    await this.db.delete(templates).where(this.scoped(eq(templates.id, id)))
    await this.audit.log(actor, {
      action: 'template.deleted',
      entityType: 'template',
      entityId: id,
      summary: `Deleted template "${template.name}"`
    })
  }

  // Helpers ------------------------------------------------------------------

  /** The visual editor exports single-line MJML: keep the stored source readable. */
  private source(mjml: string, editor: TemplateRow['editor']): string {
    return editor === 'visual' ? this.formatter.format(mjml) : mjml
  }

  /**
   * MJML rendered from a visual-editor design. A code template keeps only the
   * (readable) MJML: the design would go stale with the first hand edit.
   */
  private async fromDesign(
    design: TemplateDesign,
    editor: TemplateRow['editor']
  ): Promise<TemplateSource> {
    const content = TemplateDesignEnvelope.read(design)

    if (!content) throw new ValidationError('The email design is not valid', { field: 'design' })

    const rendered = await this.designs.mjml(content)

    // Checked before formatting and compiling, which both grow with the size of the email.
    if (rendered.length > MAX_MJML) {
      throw new ValidationError('This email is too long. Remove some blocks and save again.', {
        field: 'design'
      })
    }

    return { mjml: this.formatter.format(rendered), design: editor === 'visual' ? design : null }
  }

  /** Transactional templates require a slug; marketing templates never carry one. */
  private slugFor(kind: TemplateRow['kind'], slug: string | null | undefined): string | null {
    if (kind !== 'transactional') return null

    if (!slug)
      throw new ValidationError('Transactional templates need a slug, e.g. password-reset', {
        field: 'slug'
      })

    return slug
  }

  /** Slugs are unique within the organization only. */
  private async assertSlugAvailable(slug: string, exceptId?: string) {
    const [row] = await this.db
      .select({ id: templates.id })
      .from(templates)
      .where(
        this.scoped(eq(templates.slug, slug), exceptId ? ne(templates.id, exceptId) : undefined)
      )

    if (row)
      throw new ConflictError(
        `The slug "${slug}" is already used by another template`,
        'slug_taken',
        { field: 'slug' }
      )
  }

  private async nextFreeSlug(base: string): Promise<string> {
    const stem = base.slice(0, 60)

    const taken = new Set(
      (
        await this.db
          .select({ slug: templates.slug })
          .from(templates)
          .where(this.scoped(ilike(templates.slug, `${escapeLike(stem)}%`)))
      ).map((r) => r.slug)
    )

    if (!taken.has(stem)) return stem

    for (let i = 2; ; i++) {
      const candidate = `${stem}-${i}`

      if (!taken.has(candidate)) return candidate
    }
  }

  private async insert(
    values: Omit<typeof templates.$inferInsert, 'organizationId'>
  ): Promise<TemplateRow> {
    try {
      const [row] = await this.db.insert(templates).values(this.scope.values(values)).returning()

      return row!
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictError(
          `The slug "${values.slug}" is already used by another template`,
          'slug_taken',
          { field: 'slug' }
        )
      throw error
    }
  }

  private async persist(id: string, patch: TemplatePatch): Promise<TemplateRow> {
    try {
      const [row] = await this.db
        .update(templates)
        .set(patch)
        .where(this.scoped(eq(templates.id, id)))
        .returning()

      if (!row) throw new NotFoundError('Template', id)

      return row
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictError(
          `The slug "${patch.slug}" is already used by another template`,
          'slug_taken',
          { field: 'slug' }
        )
      throw error
    }
  }
}
