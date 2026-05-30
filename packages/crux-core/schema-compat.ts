/**
 * Schema compatibility utilities for cross-provider structured output.
 *
 * Anthropic's structured output API rejects JSON Schema properties like
 * `maxItems`, `minItems`, `maximum`, `minimum` that other providers support.
 * Rather than removing Zod constraints from prompt definitions (which serve
 * as useful validation for OpenAI/Gemini), we strip unsupported properties
 * at the adapter level before passing to Anthropic.
 *
 * @module
 */

// ─────────────────────────────────────────────────────────────────
// JSON Schema Sanitization
// ─────────────────────────────────────────────────────────────────

/** A JSON Schema represented as a plain object. */
type JsonSchemaObject = Record<string, unknown>

/** JSON Schema properties that Anthropic does not support in structured output. */
const ANTHROPIC_UNSUPPORTED_KEYS = new Set([
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
])

/**
 * Recursively strip unsupported properties from a JSON Schema object.
 *
 * Creates a shallow clone at each level — the original object is not mutated.
 */
function stripUnsupportedKeys(schema: JsonSchemaObject): JsonSchemaObject {
  const result: JsonSchemaObject = {}

  for (const [key, value] of Object.entries(schema)) {
    if (ANTHROPIC_UNSUPPORTED_KEYS.has(key)) continue

    if (key === 'properties' && value && typeof value === 'object') {
      const props: JsonSchemaObject = {}
      for (const [propKey, propValue] of Object.entries(value as JsonSchemaObject)) {
        props[propKey] =
          propValue && typeof propValue === 'object'
            ? stripUnsupportedKeys(propValue as JsonSchemaObject)
            : propValue
      }
      result[key] = props
    } else if (key === 'items' && value && typeof value === 'object') {
      result[key] = stripUnsupportedKeys(value as JsonSchemaObject)
    } else if (key === 'anyOf' || key === 'oneOf' || key === 'allOf') {
      result[key] = Array.isArray(value)
        ? (value as unknown[]).map((v) =>
            v && typeof v === 'object' ? stripUnsupportedKeys(v as JsonSchemaObject) : v,
          )
        : value
    } else if (key === 'additionalProperties' && value && typeof value === 'object') {
      result[key] = stripUnsupportedKeys(value as JsonSchemaObject)
    } else {
      result[key] = value
    }
  }

  return result
}

/**
 * Sanitize a JSON Schema for Anthropic compatibility.
 *
 * Strips properties like `maxItems`, `minimum`, `maximum` etc. that
 * Anthropic's structured output API rejects with 400 errors.
 *
 * Returns the schema unchanged for non-Anthropic providers.
 */
export function sanitizeJsonSchema(jsonSchema: JsonSchemaObject, provider: string): JsonSchemaObject {
  if (!provider.startsWith('anthropic')) return jsonSchema
  return stripUnsupportedKeys(jsonSchema)
}
