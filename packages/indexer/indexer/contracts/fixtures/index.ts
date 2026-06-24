/**
 * Aggregate fixture entry point for the native runtime contract spine.
 *
 * Contract-specific fixture modules stay near their schemas. This index gives
 * cross-language test generation one stable place to discover the fixture
 * groups that already have TypeScript-owned payloads.
 *
 * @module
 */

/** Contract groups with shared TypeScript fixture payloads. */
export const nativeRuntimeContractFixtureGroups = ['worker-events', 'native-static'] as const

export {
  readNativeRuntimeSharedFixture,
  type NativeRuntimeSharedFixtureMap,
  type NativeRuntimeSharedFixtureName,
  type NativeStaticProtocolSharedFixture,
} from './shared'

export {
  workerEventFixtureOptions,
  workerEventFixturePatch,
} from '../worker-events/fixtures'
export {
  nativeStaticCompilerRequestFixtures,
  nativeStaticCompilerResponseFixtures,
  nativeStaticPreparedPlanFixture,
  nativeStaticRunIdentityFixture,
  nativeStaticSourceFileFixture,
  nativeStaticTelemetryFixture,
} from '../native-static/fixtures'
