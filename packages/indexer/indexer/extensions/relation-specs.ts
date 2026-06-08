import type { IndexRelationPolicy } from '../relation-registry'
import type { RelationSpec } from './types'

/**
 * Converts a built-in relation policy into the manifest shape used by extensions.
 *
 * First-party Crux relations still come from the internal relation registry. Mirroring those policies
 * into extension manifests lets extractor registration and relation validation use the same data model
 * that future external extensions will use.
 */
export function relationSpecFromPolicy(policy: IndexRelationPolicy): RelationSpec {
  return {
    type: policy.type,
    fromKinds: policy.fromKinds,
    toKinds: policy.toKinds,
    presentation: policy.presentation,
    fidelity: policy.partial ? 'partial' : 'resolved',
    runtimeJoin: policy.runtimeJoin,
  }
}

/**
 * Validates relation declarations before extractor execution.
 *
 * The validator returns diagnostics as values instead of throwing so registry construction can decide
 * how to present setup errors. Today it rejects empty relation types and duplicate relation contracts;
 * endpoint validation can be added here without changing extractor return values.
 */
export function validateRelationSpecs(specs: readonly RelationSpec[]): readonly string[] {
  return specs.reduce<{ readonly seen: ReadonlySet<string>; readonly diagnostics: readonly string[] }>((state, spec) => {
    if (!spec.type) {
      return {
        seen: state.seen,
        diagnostics: [...state.diagnostics, 'Relation specs must include a non-empty type.'],
      }
    }
    return {
      seen: new Set([...state.seen, spec.type]),
      diagnostics: state.seen.has(spec.type)
        ? [...state.diagnostics, `Duplicate relation spec: ${spec.type}`]
        : state.diagnostics,
    }
  }, { seen: new Set<string>(), diagnostics: [] }).diagnostics
}
