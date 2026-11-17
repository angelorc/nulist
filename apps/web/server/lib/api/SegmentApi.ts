import type {
  V1Page,
  V1PageQuery,
  V1Segment,
  V1SegmentContact,
  V1SegmentContactsQuery
} from '../../../shared/schemas/v1'
import type { SegmentContact, SegmentService, SegmentWithCount } from '../segments/SegmentService'
import { V1Presenter } from './V1Presenter'

export class SegmentApi {
  constructor(private readonly segments: SegmentService) {}

  static present(segment: SegmentWithCount): V1Segment {
    return {
      id: segment.id,
      object: 'segment',
      name: segment.name,
      description: segment.description,
      rules: segment.rules,
      summary: segment.summary,
      contactCount: segment.contactCount,
      createdAt: V1Presenter.iso(segment.createdAt),
      updatedAt: V1Presenter.iso(segment.updatedAt)
    }
  }

  static contact(contact: SegmentContact): V1SegmentContact {
    return {
      id: contact.id,
      object: 'contact',
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      status: contact.status,
      createdAt: V1Presenter.iso(contact.createdAt)
    }
  }

  async list(query: V1PageQuery): Promise<V1Page<V1Segment>> {
    const segments = await this.segments.list()

    return V1Presenter.page(V1Presenter.slice(segments, query), (segment) =>
      SegmentApi.present(segment)
    )
  }

  async get(id: string): Promise<V1Segment> {
    return SegmentApi.present(await this.segments.get(id))
  }

  async contacts(id: string, query: V1SegmentContactsQuery): Promise<V1Page<V1SegmentContact>> {
    const page = await this.segments.contacts(id, query)

    return V1Presenter.page(page, (contact) => SegmentApi.contact(contact))
  }
}
