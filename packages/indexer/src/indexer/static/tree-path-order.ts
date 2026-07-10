import type { ProjectDefinition } from '@use-crux/core/project-index'
import { compareCodepoint, compareCodepointSequence } from '../sort'

/**
 * Orders authored tree-path projections before they enter cacheable static output.
 *
 * Tree leaves may resolve through local or imported definitions, so asynchronous
 * file reads can complete in a different order than the source traversal that
 * discovered them. Sorting by authored path first keeps static cache payloads
 * byte-stable without changing the emitted definition set.
 */
export function compareTreePathDefinitions(left: ProjectDefinition, right: ProjectDefinition): number {
  return (
    compareCodepointSequence(left.path ?? [], right.path ?? []) ||
    compareCodepoint(left.id, right.id) ||
    compareCodepoint(left.kind, right.kind) ||
    compareCodepoint(left.name ?? '', right.name ?? '')
  )
}
