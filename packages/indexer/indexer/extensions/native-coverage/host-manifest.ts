import type { StaticEvidenceInterestManifest } from '../static-evidence/types'
import type { ExtractorIdentity } from '../runtime/engine'
import {
  isBundledCruxStaticExtractor,
  nativeStaticExtractorCoverage,
  type NativeStaticExtractorCoverage,
} from './coverage'

export type StaticExtractorHostMode = 'native-covered' | 'typescript-bundled' | 'typescript-extension'

/** Native/TypeScript execution decision for one static extractor identity. */
export interface StaticExtractorHostPlan {
  readonly extension: ExtractorIdentity['extension']
  readonly name: string
  readonly mode: StaticExtractorHostMode
  readonly native?: NativeStaticExtractorCoverage
  readonly reason?: string
}

/** Runtime manifest for the TypeScript extension host boundary. */
export interface StaticExtensionHostManifest {
  readonly extractors: readonly StaticExtractorHostPlan[]
  readonly bundledNativeExtractorCount: number
  readonly bundledTypeScriptExtractorCount: number
  readonly extensionTypeScriptExtractorCount: number
  readonly typeScriptRuleCount: number
  readonly requiresTypeScriptHostForBundled: boolean
  readonly requiresTypeScriptHostForExtensions: boolean
  readonly requiresTypeScriptHostForRules: boolean
  readonly requiresCompatibilityEvidence: boolean
  readonly compatibilityReason?: string
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
  const bundledTypeScriptExtractorCount = plans.filter((plan) => plan.mode === 'typescript-bundled').length
  const extensionTypeScriptExtractorCount = plans.filter((plan) => plan.mode === 'typescript-extension').length
  const compatibilityMode = input.staticInterests.compatibility?.mode ?? 'compatibility'
  const requiresCompatibilityEvidence = compatibilityMode === 'compatibility'
  const requiresTypeScriptHostForBundled = bundledTypeScriptExtractorCount > 0
  const requiresTypeScriptHostForExtensions = extensionTypeScriptExtractorCount > 0
  const requiresTypeScriptHostForRules = input.typeScriptRuleCount > 0
  return {
    extractors: plans,
    bundledNativeExtractorCount,
    bundledTypeScriptExtractorCount,
    extensionTypeScriptExtractorCount,
    typeScriptRuleCount: input.typeScriptRuleCount,
    requiresTypeScriptHostForBundled,
    requiresTypeScriptHostForExtensions,
    requiresTypeScriptHostForRules,
    requiresCompatibilityEvidence,
    ...(input.staticInterests.compatibility?.reason
      ? { compatibilityReason: input.staticInterests.compatibility.reason }
      : {}),
    nativeOnlyEligible:
      !requiresTypeScriptHostForBundled &&
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
  const native = nativeStaticExtractorCoverage(extractor)
  if (native.covered) {
    return {
      extension: extractor.extension,
      name: extractor.name,
      mode: 'native-covered',
      native,
    }
  }
  return {
    extension: extractor.extension,
    name: extractor.name,
    mode: 'typescript-bundled',
    native,
    reason: native.reason,
  }
}
