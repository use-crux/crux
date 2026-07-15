/**
 * Create a tool-name registry with no inherited keys.
 *
 * Portable tool names may legally be `__proto__`, `constructor`, or another
 * ordinary object-prototype key. A null prototype makes every accepted name an
 * own data property and keeps missing-name lookup from falling through to
 * `Object.prototype`.
 *
 * @internal
 */
export function createToolRegistry<T>(
  ...sources: readonly (Readonly<Record<string, T>> | undefined)[]
): Record<string, T> {
  const registry = Object.create(null) as Record<string, T>;
  for (const source of sources) {
    for (const [name, value] of Object.entries(source ?? {})) {
      registry[name] = value;
    }
  }
  return registry;
}
