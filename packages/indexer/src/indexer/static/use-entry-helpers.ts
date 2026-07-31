import type { InjectionUseFacts, ProjectDefinition, ProjectDefinitionKind } from '@use-crux/core/project-index'

/** Converts an authored use-entry variable into the safe id fragment used by index definitions. */
export function safeUseEntryId(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .toLowerCase()
}

/** Returns the relation hint implied by a resolved target definition kind. */
export function relationHintForTarget(kind: ProjectDefinitionKind | undefined): InjectionUseFacts['relationHint'] | undefined {
  if (kind === 'context' || kind === 'injectable' || kind === 'memory' || kind === 'blackboard' || kind === 'thread') return kind
  return undefined
}

/** Reads normalized injection use entries from definition metadata. */
export function factsUseEntries(definition: ProjectDefinition): readonly InjectionUseFacts[] {
  const facts = definition.metadata?.facts
  if (!facts || typeof facts !== 'object' || !('useEntries' in facts)) return []
  const entries = (facts as { useEntries?: unknown }).useEntries
  return Array.isArray(entries) ? (entries.filter(isInjectionUseFacts) as InjectionUseFacts[]) : []
}

/** Narrows unknown metadata values to structurally valid injection use facts. */
export function isInjectionUseFacts(value: unknown): value is InjectionUseFacts {
  return Boolean(value && typeof value === 'object')
}
