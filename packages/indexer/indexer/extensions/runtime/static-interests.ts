import type { StaticEvidenceInterestManifest } from '../../static-index/extension-host/evidence/types'
import type { StaticExtensionHostManifest } from '../../static-index/extension-host/host-plan/host-manifest'

/**
 * Narrows native evidence callbacks to extractors that still need the TypeScript host.
 *
 * Top-level call and constructor interests remain broad because they drive source
 * selection and parser filters. The `extractors` list is the executable callback
 * contract consumed by native syntax, so native-covered extractors are removed to
 * avoid duplicate first-party projection work.
 */
export function typeScriptHostStaticInterests(
  interests: StaticEvidenceInterestManifest,
  extractors: StaticExtensionHostManifest['extractors'],
): StaticEvidenceInterestManifest {
  const typeScriptExtractors = new Set(
    extractors
      .filter((extractor) => extractor.mode !== 'native-covered')
      .map((extractor) => `${extractor.extension.name}:${extractor.name}`),
  )
  const filtered = (interests.extractors ?? []).filter((extractor) =>
    typeScriptExtractors.has(`${extractor.extension.name}:${extractor.name}`),
  )
  return {
    ...interests,
    ...(filtered.length > 0 ? { extractors: filtered } : { extractors: undefined }),
  }
}
