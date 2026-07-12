/** Generic canonical DefinitionRef → Catalog link projection for Run Detail. */

import type { DefinitionRef } from '@use-crux/core/observability'
import type { NavState } from '@/app/navigation/useNavigation'

export interface DefinitionRefLink {
  label: string
  value: string
  kind: string
  role: string
  source?: DefinitionRef['source']
  resolved: boolean
  to?: NavState
}

/**
 * Resolve the exact runtime-emitted ids against the current Project Index.
 * Missing definitions retain their role/kind/last-known source as plain text;
 * they never become dead links or disappear silently.
 */
export function definitionRefLinks(
  refs: readonly DefinitionRef[],
  knownDefinitionIds: ReadonlySet<string> | undefined,
): DefinitionRefLink[] {
  return refs.map((ref) => {
    const resolved = knownDefinitionIds?.has(ref.id) === true
    return {
      label: ref.kind,
      value: ref.id,
      kind: ref.kind,
      role: ref.role,
      source: ref.source,
      resolved,
      ...(resolved ? { to: { view: 'library-index', promptId: ref.id } as NavState } : {}),
    }
  })
}
