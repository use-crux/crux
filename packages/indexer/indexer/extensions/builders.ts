import type { ProjectDefinition } from '@crux/core/project-index'
import type { DefinitionBuilder, ReferenceBuilder, SourceRefBuilder } from './types'

/**
 * Creates the definition builder exposed as `ctx.define`.
 *
 * The builder keeps extractor code pure while still applying compiler-owned definition defaults such
 * as source location, snippets, fidelity, status, and metadata normalization. Production parser
 * contexts provide `defineProjectDefinition`; tests that only exercise relation/reference behavior can
 * omit it and use `fromProjectDefinition(...)` instead.
 *
 * @throws When `definition(...)` is called without a compiler-bound definition factory.
 */
export function createDefinitionBuilder(
  defineProjectDefinition?: (input: {
    readonly id: string
    readonly kind: Parameters<DefinitionBuilder['definition']>[0]['kind']
    readonly name: string
    readonly metadata: Record<string, unknown>
  }) => ProjectDefinition,
): DefinitionBuilder {
  return {
    definition: (input) => {
      if (!defineProjectDefinition) {
        throw new Error('Definition builder is not bound to a Project Index compiler context.')
      }
      return {
        variableName: input.variableName,
        definition: defineProjectDefinition({
          id: input.id,
          kind: input.kind,
          name: input.name,
          metadata: { ...(input.metadata ?? {}) },
        }),
      }
    },
    fromProjectDefinition: (input) => input,
  }
}

/**
 * Creates unresolved-reference helpers for extractor contexts.
 *
 * References are deliberately unresolved at extraction time. `variable(...)` records an authored local
 * or imported binding name that resolver stages can bind after all definitions are known. `id(...)`
 * records a target that is already a stable index definition id.
 */
export function createReferenceBuilder(): ReferenceBuilder {
  return {
    variable: (type, toVariable) => ({ type, toVariable }),
    id: (type, toId) => ({ type, toId }),
  }
}

/**
 * Creates a source-reference builder that always returns empty results.
 *
 * This is useful for tests and non-source-backed contexts because it preserves the same method surface
 * as production extraction without fabricating source locations. Extractors can call source-ref helpers
 * unconditionally and still receive immutable no-op values when no source view exists.
 */
export function createEmptySourceRefBuilder(): SourceRefBuilder {
  return {
    property: () => undefined,
    callbackProperty: () => undefined,
    templateInterpolations: () => [],
    schemaProperty: () => ({ sourceRefs: [] }),
    helperRefsForProperty: () => [],
  }
}
