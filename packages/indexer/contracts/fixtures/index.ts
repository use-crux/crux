/**
 * Aggregate fixture entry point for the Static Index runtime contract spine.
 *
 * Contract-specific fixture modules stay near their schemas. This index gives
 * cross-language test generation one stable place to discover the fixture
 * groups that already have TypeScript-owned payloads.
 *
 * @module
 */

/** Contract groups with shared TypeScript fixture payloads. */
export const staticIndexRuntimeContractFixtureGroups = [
  'worker-events',
  'static-syntax-records',
  'static-index',
  'semantic-evidence',
] as const

export {
  readStaticIndexRuntimeSharedFixture,
  type StaticIndexRuntimeSharedFixtureMap,
  type StaticIndexRuntimeSharedFixtureName,
  type StaticIndexIdentitySharedFixture,
  type StaticIndexProtocolSharedFixture,
  type StaticIndexProtocolCasesSharedFixture,
  type StaticSyntaxRecordsSharedFixture,
  type StaticSyntaxRecordCasesSharedFixture,
  type SemanticEvidenceSharedFixture,
  type WorkerEventCasesSharedFixture,
  type WorkerEventsSharedFixture,
} from './shared'

export {
  workerEventFixtureOptions,
  workerEventFixturePatch,
} from '../worker-events/fixtures'
export {
  staticIndexCompilerRequestFixtures,
  staticIndexCompilerResponseFixtures,
  staticIndexIdentityManifestFixture,
  staticIndexPreparedPlanFixture,
  staticIndexRunIdentityFixture,
  staticIndexSourceFileFixture,
  staticIndexTelemetryFixture,
} from '../static-index/fixtures'
