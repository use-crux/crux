import type { CatalogRelationPolicy } from '../relation-registry'
import type { RelationSpec } from './types'

export function relationSpecFromPolicy(policy: CatalogRelationPolicy): RelationSpec {
  return {
    type: policy.type,
    fromKinds: policy.fromKinds,
    toKinds: policy.toKinds,
    presentation: policy.presentation,
    fidelity: policy.partial ? 'partial' : 'resolved',
    runtimeJoin: policy.runtimeJoin,
  }
}

export function validateRelationSpecs(specs: readonly RelationSpec[]): readonly string[] {
  const seen = new Set<string>()
  const diagnostics: string[] = []
  for (const spec of specs) {
    if (!spec.type) diagnostics.push('Relation specs must include a non-empty type.')
    if (seen.has(spec.type)) diagnostics.push(`Duplicate relation spec: ${spec.type}`)
    seen.add(spec.type)
  }
  return diagnostics
}
