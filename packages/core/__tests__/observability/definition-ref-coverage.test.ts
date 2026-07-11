import { describe, expect, it } from 'vitest'
import {
  DEFINITION_KIND_COVERAGE,
  type DirectlyObservedKind,
} from '../../src/project-index/definition-kind-coverage'
import {
  DIRECTLY_OBSERVED_DEFINITION_REF_ROLES,
  definitionRef,
} from '../../src/observability/definition-ref'
import { DefinitionRefRoleSchema } from '../../src/observability/schema'

/**
 * The machine-readable guard: every directly-observed kind in the coverage
 * manifest must have a closed role/builder mapping, and vice versa. This is the
 * runtime counterpart to the compile-time `Record<DirectlyObservedKind, …>`
 * total-map check, so a manifest drift fails a test even in JS-only consumers.
 */
const directlyObservedKinds = Object.entries(DEFINITION_KIND_COVERAGE)
  .filter(([, descriptor]) => descriptor.primary === 'directly-observed')
  .map(([kind]) => kind as DirectlyObservedKind)

describe('directly-observed kinds ↔ DefinitionRef role/builder mapping', () => {
  it('covers every directly-observed manifest kind with exactly one role', () => {
    const mapped = Object.keys(DIRECTLY_OBSERVED_DEFINITION_REF_ROLES).sort()
    expect(mapped).toEqual([...directlyObservedKinds].sort())
  })

  it('maps no kind that is not directly-observed', () => {
    for (const kind of Object.keys(DIRECTLY_OBSERVED_DEFINITION_REF_ROLES)) {
      expect(DEFINITION_KIND_COVERAGE[kind as DirectlyObservedKind].primary).toBe(
        'directly-observed',
      )
    }
  })

  it('uses only schema-valid roles', () => {
    for (const role of Object.values(DIRECTLY_OBSERVED_DEFINITION_REF_ROLES)) {
      expect(DefinitionRefRoleSchema.safeParse(role).success).toBe(true)
    }
  })

  it('builds a canonical <kind>:<safeId(id)> ref for every directly-observed kind', () => {
    for (const kind of directlyObservedKinds) {
      const ref = definitionRef(kind, 'sample-id')
      expect(ref).toEqual({
        id: `${kind}:sample-id`,
        kind,
        role: DIRECTLY_OBSERVED_DEFINITION_REF_ROLES[kind],
      })
    }
  })
})
