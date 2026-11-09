import { z } from 'zod'
import type { JsonObject } from '../../../shared/types/domain'

const jsonObjectSchema = z.record(z.string(), z.json())

/**
 * The JSON form of an object, as a jsonb column stores it: Dates become ISO
 * strings, undefined fields and functions are dropped.
 */
export function toJsonObject<T extends object>(value: T): JsonObject {
  return jsonObjectSchema.parse(JSON.parse(JSON.stringify(value)))
}
