import type { IndexRuleDescriptor } from '@use-crux/core/project-index'
import { indexLintRuleIds } from './rules'

/** Minimal rule declaration shape needed by lint policy filters. */
export type IndexLintRuleIdDeclaration = Pick<IndexRuleDescriptor, 'id'>

/**
 * Builds the known lint rule id set for one compiler finalization pass.
 *
 * Built-in ids are always present. Extension ids come from normalized rule
 * descriptors so config validation and source suppressions stay data-driven.
 */
export function createKnownIndexLintRuleIds(
  ruleDescriptors: readonly IndexLintRuleIdDeclaration[] = [],
): ReadonlySet<string> {
  return new Set([...indexLintRuleIds, ...ruleDescriptors.map((descriptor) => descriptor.id)])
}
