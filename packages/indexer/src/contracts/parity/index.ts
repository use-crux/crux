/**
 * Native parity normalization contract.
 *
 * This subpath owns the TypeScript-side canonical shape shared by devtools
 * parity scripts, contract tests, and host implementations that mirror the
 * same field coverage in another language.
 *
 * @module
 */

export {
  canonicalIndexPatchFactsJson,
  canonicalStaticExtractionJson,
} from './index-patch'
export { parityFieldCoverage } from './fields'
export type { JsonValue } from './json'

