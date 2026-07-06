/**
 * Collision-checked tool merging for prompt resolution.
 *
 * Prompt-owned tool surfaces are merged in a fixed family order before adapter
 * execution sees them. This helper owns the single collision policy: every
 * prompt-time collision throws with both contributing owners named; call-site
 * tools are intentionally applied later by adapter execution without this
 * check.
 *
 * @module
 */

import type { AnyToolSet } from '../types'

/** User-facing owner label used in tool-collision errors. */
export type ToolOwnerLabel =
  | `skill:${string}`
  | `context:${string}`
  | `context[${number}]`
  | `contributor:${string}`
  | `blackboard:${string}`
  | 'prompt config'

/**
 * Create the canonical tool-collision error.
 *
 * The message is snapshot-tested because it is the public explanation of the
 * merge policy and the one sanctioned override path.
 */
export function toolCollisionError(name: string, firstOwner: ToolOwnerLabel, secondOwner: ToolOwnerLabel): Error {
  return new Error(
    `Tool name collision for "${name}": contributed by both ${firstOwner} and ${secondOwner}. ` +
      'Rename one of them, or pass the overriding tool at the call site (call-site tools intentionally win).',
  )
}

/** Stateful prompt-time merger that remembers the first owner of each tool name. */
export interface ToolMergeAccumulator {
  readonly tools: AnyToolSet
  readonly owners: ReadonlyMap<string, ToolOwnerLabel>
  merge(incoming: AnyToolSet | undefined, owner: ToolOwnerLabel): void
  mergeOwned(incoming: AnyToolSet | undefined, incomingOwners: ReadonlyMap<string, ToolOwnerLabel>): void
}

/** Merge one tool set into an existing target and owner map. */
export function mergeToolSet(
  target: AnyToolSet,
  owners: Map<string, ToolOwnerLabel>,
  incoming: AnyToolSet | undefined,
  owner: ToolOwnerLabel,
): void {
  if (!incoming) return
  for (const [name, tool] of Object.entries(incoming)) {
    const firstOwner = owners.get(name)
    if (firstOwner) throw toolCollisionError(name, firstOwner, owner)
    owners.set(name, owner)
    target[name] = tool
  }
}

/** Merge a tool set whose individual names already carry owner labels. */
export function mergeOwnedToolSet(
  target: AnyToolSet,
  owners: Map<string, ToolOwnerLabel>,
  incoming: AnyToolSet | undefined,
  incomingOwners: ReadonlyMap<string, ToolOwnerLabel>,
): void {
  if (!incoming) return
  for (const [name, tool] of Object.entries(incoming)) {
    const owner = incomingOwners.get(name)
    if (!owner) continue
    const firstOwner = owners.get(name)
    if (firstOwner) throw toolCollisionError(name, firstOwner, owner)
    owners.set(name, owner)
    target[name] = tool
  }
}

/** Create a merge accumulator with an empty target and owner map. */
export function createToolMergeAccumulator(): ToolMergeAccumulator {
  const tools: AnyToolSet = {}
  const owners = new Map<string, ToolOwnerLabel>()

  return {
    tools,
    owners,
    merge(incoming, owner) {
      mergeToolSet(tools, owners, incoming, owner)
    },
    mergeOwned(incoming, incomingOwners) {
      mergeOwnedToolSet(tools, owners, incoming, incomingOwners)
    },
  }
}
