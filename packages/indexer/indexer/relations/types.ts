import type { ProjectDefinitionKind } from '@use-crux/core/project-index'

export type IndexRelationPresentation = 'edge' | 'detail' | 'both'

/**
 * Describes how a relation type should appear in the Project Index graph.
 *
 * Policies are data-only values: relation discovery remains independent from
 * UI presentation and runtime-correlation decisions, while consumers can still
 * render and join relation facts consistently.
 */
export interface IndexRelationPolicy {
  readonly type: string
  readonly fromKinds?: readonly ProjectDefinitionKind[]
  readonly toKinds?: readonly ProjectDefinitionKind[]
  readonly presentation: IndexRelationPresentation
  readonly partial: boolean
  readonly runtimeJoin: boolean
}
