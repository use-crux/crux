import type { IndexPatch } from '../patches'

type StreamedSourceProfileFile = NonNullable<IndexPatch['semanticSourceProfile']>['files'][number]

/** Splits source-profile rows into bounded worker stream batches. */
export function sourceProfileBatches<TValue>(
  values: readonly TValue[],
  batchSize: number,
): readonly (readonly TValue[])[] {
  const batches: Array<readonly TValue[]> = []
  for (let index = 0; index < values.length; index += batchSize) {
    batches.push(values.slice(index, index + batchSize))
  }
  return batches
}

/**
 * Reconstructs source-profile metadata for legacy worker streams.
 *
 * Current streams carry aggregate completeness, dependency-closure, and byte
 * totals on the terminal `phase:done.patch.semanticSourceProfile` object. This
 * fallback keeps older row-only streams decodable, but cannot prove
 * completeness because `sourceProfile:batch` intentionally contains only file
 * rows.
 */
export function semanticSourceProfileFromStreamFiles(
  files: readonly StreamedSourceProfileFile[],
): NonNullable<IndexPatch['semanticSourceProfile']> {
  return {
    files,
    dependencyClosure: files.map((file) => file.file).sort(),
    sourceBytes: files.reduce((sum, file) => sum + file.sourceBytes, 0),
    complete: true,
  }
}
