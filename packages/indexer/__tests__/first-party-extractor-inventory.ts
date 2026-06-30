import { createIndexerExtensionRuntime } from '../indexer/extensions'
import { staticIndexExtractorCoverage } from '../indexer/static-index/extension-host/host-plan/coverage'
import { cruxCoreExtension } from '../indexer/extractors/crux-core-extension'

/**
 * Test helpers for tracking first-party static extractor migration coverage.
 *
 * The inventory is intentionally derived from `cruxCoreExtension.extractors`
 * so a new bundled primitive fails the Phase 1 audit until its fixture and
 * Static Index coverage status are recorded.
 *
 * @module
 */

/** Fixture coverage state for one bundled first-party extractor family. */
export type FirstPartyFixtureCoverage = 'dedicated-fixture' | 'missing-fixture'

/** Static Index coverage state for one bundled first-party extractor family. */
export type FirstPartyStaticIndexCoverage = 'covered' | 'typescript-host'

/** One row in the first-party primitive migration inventory. */
export interface FirstPartyPrimitiveFixtureInventoryEntry {
  readonly extractor: string
  readonly fixtureCoverage: FirstPartyFixtureCoverage
  readonly staticIndexCoverage: FirstPartyStaticIndexCoverage
}

/** Current Node ownership reasons for Static Index first-party runs. */
export interface FirstPartyStaticIndexNodeOwnershipAudit {
  readonly nativeOnlyEligible: boolean
  readonly nodeStartsBecause: readonly string[]
  readonly bundledNativeExtractors: readonly string[]
  readonly bundledTypeScriptExtractors: readonly string[]
  readonly typeScriptRuleCount: number
}

const firstPartyFixtureCoverageByExtractor: Readonly<Record<string, FirstPartyFixtureCoverage | undefined>> = {
  'rag.retriever': 'dedicated-fixture',
  safety: 'dedicated-fixture',
  scorer: 'dedicated-fixture',
  storage: 'dedicated-fixture',
  workspace: 'dedicated-fixture',
  eval: 'dedicated-fixture',
  'skill-registry': 'dedicated-fixture',
  'registry-skill': 'dedicated-fixture',
  tool: 'dedicated-fixture',
  injectable: 'dedicated-fixture',
  context: 'dedicated-fixture',
  prompt: 'dedicated-fixture',
  agent: 'dedicated-fixture',
  composition: 'dedicated-fixture',
  memory: 'dedicated-fixture',
  blackboard: 'dedicated-fixture',
  routing: 'dedicated-fixture',
  flow: 'dedicated-fixture',
}

/**
 * Returns the current first-party primitive fixture/native coverage matrix.
 *
 * The function throws for unknown bundled extractors instead of silently
 * treating them as missing, because the inventory is the migration checklist
 * later phases rely on.
 */
export function firstPartyPrimitiveFixtureInventory(): readonly FirstPartyPrimitiveFixtureInventoryEntry[] {
  return (cruxCoreExtension.extractors ?? []).map((extractor) => {
    const fixtureCoverage = firstPartyFixtureCoverageByExtractor[extractor.name]
    if (!fixtureCoverage) {
      throw new Error(`First-party fixture inventory is missing extractor coverage for ${extractor.name}.`)
    }
    const nativeCoverage = staticIndexExtractorCoverage({
      extension: { name: cruxCoreExtension.name, version: cruxCoreExtension.version },
      name: extractor.name,
    })
    return {
      extractor: extractor.name,
      fixtureCoverage,
      staticIndexCoverage: nativeCoverage.covered ? 'covered' : 'typescript-host',
    }
  })
}

/**
 * Returns the current reasons Static Index first-party indexing still needs Node.
 *
 * This intentionally combines static ownership facts from the target
 * architecture with the data-only extension host manifest so changes in
 * bundled coverage, TypeScript rules, or compatibility evidence are visible in
 * a small snapshot-style test.
 */
export function firstPartyStaticIndexNodeOwnershipAudit(): FirstPartyStaticIndexNodeOwnershipAudit {
  const runtime = createIndexerExtensionRuntime({ extensions: [cruxCoreExtension] })
  const staticHost = runtime.manifest.staticHost
  const inventory = firstPartyPrimitiveFixtureInventory()
  const nodeStartsBecause = [
    'Go asks Node to inspect the static syntax plan before Rust/Oxc parses files.',
  ]
  if (staticHost.bundledTypeScriptExtractorCount > 0) {
    nodeStartsBecause.push('Node projects Rust/Oxc syntax records through bundled TypeScript extractors.')
    nodeStartsBecause.push(`${staticHost.bundledTypeScriptExtractorCount} bundled extractor families are not fully native-covered.`)
  }
  if (staticHost.typeScriptRuleCount > 0) {
    nodeStartsBecause.push(`${staticHost.typeScriptRuleCount} TypeScript index rule still runs in the extension host.`)
  }
  if (staticHost.compatibilityReason) nodeStartsBecause.push(staticHost.compatibilityReason)
  return {
    nativeOnlyEligible: staticHost.nativeOnlyEligible,
    nodeStartsBecause,
    bundledNativeExtractors: inventory
      .filter((item) => item.staticIndexCoverage === 'covered')
      .map((item) => item.extractor),
    bundledTypeScriptExtractors: inventory
      .filter((item) => item.staticIndexCoverage === 'typescript-host')
      .map((item) => item.extractor),
    typeScriptRuleCount: staticHost.typeScriptRuleCount,
  }
}
