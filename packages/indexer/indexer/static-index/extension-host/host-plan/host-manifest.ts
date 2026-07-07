import type { ExtractorIdentity } from '../../../extensions/runtime/engine'
import type { StaticEvidenceInterestManifest } from '../evidence/types'
import {
  isBundledCruxStaticExtractor,
  staticIndexExtractorCoverage,
  type StaticIndexExtractorCoverage,
} from './coverage'

export type StaticExtractorHostMode = 'native-covered' | 'typescript-extension'

/** Native/TypeScript execution decision for one static extractor identity. */
export interface StaticExtractorHostPlan {
  readonly extension: ExtractorIdentity['extension']
  readonly name: string
  readonly mode: StaticExtractorHostMode
  readonly native?: StaticIndexExtractorCoverage
  readonly reason?: string
}

/**
 * Data-only execution plan for the TypeScript extension host boundary.
 *
 * The manifest is safe to serialize, inspect, and include in cache inputs. It
 * contains no parser objects or executable extension functions.
 */
export interface StaticExtensionHostManifest {
  /** Per-extractor placement decisions for native projection or TypeScript host execution. */
  readonly extractors: readonly StaticExtractorHostPlan[]
  /** Bundled first-party extractors that can be projected by Static Index without Node. */
  readonly bundledNativeExtractorCount: number
  /** Third-party extension extractors that run in the TypeScript host. */
  readonly extensionTypeScriptExtractorCount: number
  /** TypeScript index rules that still require the TypeScript host. */
  readonly typeScriptRuleCount: number
  /** Whether third-party extensions require the TypeScript host. */
  readonly requiresTypeScriptHostForExtensions: boolean
  /** Whether TypeScript index rules require the TypeScript host. */
  readonly requiresTypeScriptHostForRules: boolean
  /** Whether compatibility evidence is required because bounded static evidence is unavailable. */
  readonly requiresCompatibilityEvidence: boolean
  /** Human-readable explanation for compatibility fallback when one is known. */
  readonly compatibilityReason?: string
  /** Whether the current runtime can avoid starting the TypeScript extension host. */
  readonly nativeOnlyEligible: boolean
}

/** Builds the data-only native/TypeScript static execution plan for a runtime manifest. */
export function staticExtensionHostManifest(input: {
  readonly extractors: readonly ExtractorIdentity[]
  readonly staticInterests: StaticEvidenceInterestManifest
  readonly typeScriptRuleCount: number
}): StaticExtensionHostManifest {
  const plans = input.extractors.map(staticExtractorHostPlan)
  const bundledNativeExtractorCount = plans.filter((plan) => plan.mode === 'native-covered').length
  const extensionTypeScriptExtractorCount = plans.filter((plan) => plan.mode === 'typescript-extension').length
  const compatibilityMode = input.staticInterests.compatibility?.mode ?? 'compatibility'
  const requiresCompatibilityEvidence = compatibilityMode === 'compatibility'
  const requiresTypeScriptHostForExtensions = extensionTypeScriptExtractorCount > 0
  const requiresTypeScriptHostForRules = input.typeScriptRuleCount > 0
  return {
    extractors: plans,
    bundledNativeExtractorCount,
    extensionTypeScriptExtractorCount,
    typeScriptRuleCount: input.typeScriptRuleCount,
    requiresTypeScriptHostForExtensions,
    requiresTypeScriptHostForRules,
    requiresCompatibilityEvidence,
    ...(input.staticInterests.compatibility?.reason
      ? { compatibilityReason: input.staticInterests.compatibility.reason }
      : {}),
    nativeOnlyEligible:
      !requiresTypeScriptHostForExtensions &&
      !requiresTypeScriptHostForRules &&
      !requiresCompatibilityEvidence,
  }
}

function staticExtractorHostPlan(extractor: ExtractorIdentity): StaticExtractorHostPlan {
  if (!isBundledCruxStaticExtractor(extractor)) {
    return {
      extension: extractor.extension,
      name: extractor.name,
      mode: 'typescript-extension',
      reason: 'Extractor is not part of the bundled Crux native primitive set.',
    }
  }
  const native = staticIndexExtractorCoverage(extractor)
  if (native.covered) {
    return {
      extension: extractor.extension,
      name: extractor.name,
      mode: 'native-covered',
      native,
    }
  }
  throw new Error(
    `Bundled Crux extractor ${extractor.extension.name}:${extractor.name} is not covered by Static Index: ${native.reason ?? 'missing native coverage'}`,
  )
}
