import type { ExtractorIdentity } from './runtime'

const CRUX_CORE_EXTENSION = '@crux/indexer/crux-core'

const nativeStaticExtractorIds = new Set([
  extractorKey({
    extension: { name: CRUX_CORE_EXTENSION, version: '*' },
    name: 'routing',
  }),
])

/** Native static projection coverage for one extractor identity. */
export interface NativeStaticExtractorCoverage {
  /** Whether the extractor's full static contract is implemented by the native projector. */
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
 * Returns native static coverage for a bundled extractor.
 *
 * This intentionally uses explicit extractor identities. A bundled family must only be added after
 * its complete TypeScript extractor contract has exact normalized parity fixtures against Rust/Oxc.
 */
export function nativeStaticExtractorCoverage(
  extractor: Pick<ExtractorIdentity, 'extension' | 'name'>,
): NativeStaticExtractorCoverage {
  if (!isBundledCruxStaticExtractor(extractor)) {
    return { covered: false, reason: 'Third-party and internal TypeScript extensions run in the extension host.' }
  }
  if (nativeStaticExtractorIds.has(extractorKey(extractor))) {
    return { covered: true, family: extractor.name }
  }
  return { covered: false, reason: 'Bundled extractor family is not fully native-covered yet.' }
}

function extractorKey(extractor: Pick<ExtractorIdentity, 'extension' | 'name'>): string {
  return `${extractor.extension.name}/${extractor.name}`
}
