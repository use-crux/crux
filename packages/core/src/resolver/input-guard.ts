/**
 * Runtime input guards for prompt resolution.
 *
 * The guard catches accidental object interpolation at the exact property that
 * was coerced, which produces a better error than scanning the final prompt
 * text after information about the source field has been lost.
 *
 * @module
 */

/**
 * Get the first key of an object for error message suggestions.
 */
function firstKey(obj: object): string {
  const keys = Object.keys(obj)
  return keys[0] ?? 'someProperty'
}

/**
 * Wrap object input values in a proxy that throws on string coercion.
 *
 * Normal property access, including nested object reads, passes through
 * unchanged. Coercion through template strings or default `toString()` throws
 * with the prompt id and a concrete field-level suggestion.
 */
export function guardInputs(input: Record<string, unknown>, promptId?: string): Record<string, unknown> {
  const guarded: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (
      value != null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      !(value instanceof RegExp)
    ) {
      guarded[key] = new Proxy(value as object, {
        get(target, prop, receiver) {
          if (prop === Symbol.toPrimitive) {
            return () => {
              throw new Error(
                `Input field "${key}" is an object and cannot be interpolated into a string. ` +
                  `Use JSON.stringify(input.${key}) or access a specific property ` +
                  `(e.g., input.${key}.${firstKey(target)}).` +
                  (promptId ? ` Prompt: "${promptId}".` : ''),
              )
            }
          }
          if (prop === 'toString') {
            const original = Reflect.get(target, prop, receiver)
            if (original === Object.prototype.toString) {
              return () => {
                throw new Error(
                  `Input field "${key}" is an object and was coerced to string. ` +
                    `Use JSON.stringify(input.${key}) or access specific properties.` +
                    (promptId ? ` Prompt: "${promptId}".` : ''),
                )
              }
            }
            return original
          }
          return Reflect.get(target, prop, receiver)
        },
      })
    } else {
      guarded[key] = value
    }
  }
  return guarded
}
