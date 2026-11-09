export type JsonPrimitive = string | number | boolean | null

/** A JSON value read from the API (read-only view: absent keys read as `undefined`). */
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject

export interface JsonObject {
  readonly [key: string]: JsonValue | undefined
}

/** A JSON value sent to the API (as the API's validators accept it: no `undefined` members). */
export type JsonInput = JsonPrimitive | JsonInput[] | JsonInputObject

export interface JsonInputObject {
  [key: string]: JsonInput
}

/**
 * Whether a parsed JSON value is an object (not an array, a primitive or `null`).
 * `JSON.parse` builds plain objects of this realm, so they are all `Object` instances.
 */
export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value instanceof Object && !Array.isArray(value)
}

/** Whether a parsed JSON value is a string: the only primitive equal to its `String()` conversion. */
export function isJsonString(value: JsonValue | undefined): value is string {
  return !(value instanceof Object) && String(value) === value
}

/** Parses a response body; `undefined` when it is empty or not JSON (a proxy's HTML page…). */
export function parseJson(text: string): JsonValue | undefined {
  if (!text) return undefined

  try {
    // SAFETY: JSON.parse only produces JSON values (objects, arrays, strings, numbers, booleans, null).
    return JSON.parse(text) as JsonValue
  } catch {
    return undefined
  }
}
