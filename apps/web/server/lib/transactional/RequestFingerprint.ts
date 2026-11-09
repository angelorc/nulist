import { createHash } from 'node:crypto'
import type { TransactionalEmailInput } from '../../../shared/schemas/transactional'
import type { JsonValue } from '../../../shared/types/domain'
import { toJsonObject } from '../core/json'

/**
 * Every object key in a JSON value, sorted. Passed to `JSON.stringify` as the
 * property allow-list it fixes the key order at every nesting level.
 */
function sortedKeys(value: JsonValue): string[] {
  const keys = new Set<string>()

  JSON.stringify(value, (key: string, item: JsonValue) => {
    keys.add(key)

    return item
  })

  return [...keys].toSorted()
}

/** SHA-256 of an email request, used to tell an idempotent retry from a different request. */
export class RequestFingerprint {
  /** Equal payloads hash equally: keys are sorted and `undefined` fields dropped. */
  static of(payload: TransactionalEmailInput): string {
    const json = toJsonObject(payload)

    return createHash('sha256')
      .update(JSON.stringify(json, sortedKeys(json)))
      .digest('hex')
  }
}
