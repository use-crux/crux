/**
 * Native Static coverage and execution-plan metadata for bundled extensions.
 *
 * Coverage is explicit and data-driven: a bundled extractor is marked native
 * covered only when the Rust/Oxc projector has parity proof for the complete
 * TypeScript extractor contract.
 *
 * @module
 */

export {
  isBundledCruxStaticExtractor,
  nativeStaticExtractorCoverage,
  type NativeStaticExtractorCoverage,
} from './coverage'
export {
  staticExtensionHostManifest,
  type StaticExtensionHostManifest,
  type StaticExtractorHostMode,
  type StaticExtractorHostPlan,
} from './host-manifest'

