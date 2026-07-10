/**
 * Static Index host planning metadata for bundled extensions.
 *
 * The host plan is explicit and data-driven: a bundled extractor is marked
 * native-covered only when the Rust/Oxc projector has parity proof for the
 * complete TypeScript extractor contract.
 *
 * @module
 */

export {
  isBundledCruxStaticExtractor,
  staticIndexExtractorCoverage,
  type StaticIndexExtractorCoverage,
} from './coverage'
export {
  staticExtensionHostManifest,
  type StaticExtensionHostManifest,
  type StaticExtractorHostMode,
  type StaticExtractorHostPlan,
} from './host-manifest'
