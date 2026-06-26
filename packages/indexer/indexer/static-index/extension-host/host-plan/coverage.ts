import type { ExtractorIdentity } from '../../../extensions/runtime/engine'

const CRUX_CORE_EXTENSION = '@use-crux/indexer/crux-core'

const staticIndexExtractorIds = new Set([
  extractorKey({
    extension: { name: CRUX_CORE_EXTENSION, version: '*' },
    name: 'rag.retriever',
  }),
  extractorKey({
    extension: { name: CRUX_CORE_EXTENSION, version: '*' },
    name: 'safety',
  }),
  extractorKey({
    extension: { name: CRUX_CORE_EXTENSION, version: '*' },
    name: 'scorer',
  }),
  extractorKey({
    extension: { name: CRUX_CORE_EXTENSION, version: '*' },
    name: 'workspace',
  }),
  extractorKey({
    extension: { name: CRUX_CORE_EXTENSION, version: '*' },
    name: 'eval',
  }),
  extractorKey({
    extension: { name: CRUX_CORE_EXTENSION, version: '*' },
    name: 'skill-registry',
  }),
  extractorKey({
    extension: { name: CRUX_CORE_EXTENSION, version: '*' },
    name: 'registry-skill',
  }),
  extractorKey({
    extension: { name: CRUX_CORE_EXTENSION, version: '*' },
    name: 'tool',
  }),
  extractorKey({
    extension: { name: CRUX_CORE_EXTENSION, version: '*' },
    name: 'injectable',
  }),
  extractorKey({
    extension: { name: CRUX_CORE_EXTENSION, version: '*' },
    name: 'context',
  }),
  extractorKey({
    extension: { name: CRUX_CORE_EXTENSION, version: '*' },
    name: 'prompt',
  }),
  extractorKey({
    extension: { name: CRUX_CORE_EXTENSION, version: '*' },
    name: 'agent',
  }),
  extractorKey({
    extension: { name: CRUX_CORE_EXTENSION, version: '*' },
    name: 'composition',
  }),
  extractorKey({
    extension: { name: CRUX_CORE_EXTENSION, version: '*' },
    name: 'memory',
  }),
  extractorKey({
    extension: { name: CRUX_CORE_EXTENSION, version: '*' },
    name: 'blackboard',
  }),
  extractorKey({
    extension: { name: CRUX_CORE_EXTENSION, version: '*' },
    name: 'routing',
  }),
  extractorKey({
    extension: { name: CRUX_CORE_EXTENSION, version: '*' },
    name: 'flow',
  }),
])

/** Static Index projection coverage for one extractor identity. */
export interface StaticIndexExtractorCoverage {
  /** Whether the extractor's full static contract is implemented by the Static Index projector. */
  readonly covered: boolean
  /** Stable native primitive family name used in diagnostics and benchmark summaries. */
  readonly family?: string
  /** Human-readable reason when the extractor still needs TypeScript projection. */
  readonly reason?: string
}

/** Returns true when an extractor belongs to the bundled Crux primitive extension. */
export function isBundledCruxStaticExtractor(extractor: Pick<ExtractorIdentity, 'extension'>): boolean {
  return extractor.extension.name === CRUX_CORE_EXTENSION
}

/**
 * Returns Static Index coverage for a bundled extractor.
 *
 * A bundled family is marked covered only after the Rust/Oxc projector has
 * parity proof for the complete TypeScript extractor contract. Non-bundled
 * extensions keep running through the TypeScript extension host.
 */
export function staticIndexExtractorCoverage(
  extractor: Pick<ExtractorIdentity, 'extension' | 'name'>,
): StaticIndexExtractorCoverage {
  if (!isBundledCruxStaticExtractor(extractor)) {
    return { covered: false, reason: 'Third-party and internal TypeScript extensions run in the extension host.' }
  }
  if (staticIndexExtractorIds.has(extractorKey(extractor))) {
    return { covered: true, family: extractor.name }
  }
  return { covered: false, reason: 'Bundled extractor family is not fully native-covered yet.' }
}

function extractorKey(extractor: Pick<ExtractorIdentity, 'extension' | 'name'>): string {
  return `${extractor.extension.name}/${extractor.name}`
}
