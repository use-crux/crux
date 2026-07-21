import type { IndexPatchFacts } from '../../indexer/patches'

/**
 * `IndexPatchFacts` fields that are part of the native parity contract.
 *
 * Keep this list in lockstep with `IndexPatchFacts` and the V3 worker fact
 * kinds. A missing field here means the beta gate is not comparing that surface.
 */
export const indexPatchFactFields = [
  'prompts',
  'contexts',
  'tools',
  'lint',
  'definitions',
  'relations',
  'sourceRefs',
  'diagnostics',
  'lintFindings',
  'ruleDescriptors',
  'sources',
  'sourceGraph',
] as const satisfies readonly (keyof IndexPatchFacts)[]

/** Static extraction projection fields compared by frontend parity checks. */
export const staticExtractionFields = [
  'definitions',
  'relations',
  'diagnostics',
  'dependencies',
] as const

/** Documented field coverage for parity gates and contract tests. */
export const parityFieldCoverage = {
  indexPatchFacts: indexPatchFactFields,
  staticExtraction: staticExtractionFields,
} as const
