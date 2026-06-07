import type { ProjectDefinition, ProjectRelation } from '@crux/core/catalog'
import { relationsFromStaticDefinitions } from '../relations'
import type { StaticFoundDefinition } from '../types'

/**
 * Resolves static extractor references into Project Catalog relations.
 *
 * This is the built-in resolver phase for the current TypeScript-backed static
 * compiler path. Extractors emit relation refs; this resolver links them after
 * local and imported definitions are known.
 */
export function resolveStaticRelationReferences(
  found: readonly StaticFoundDefinition[],
  importedDefinitions = new Map<string, ProjectDefinition>(),
): ProjectRelation[] {
  return relationsFromStaticDefinitions(found, importedDefinitions)
}
