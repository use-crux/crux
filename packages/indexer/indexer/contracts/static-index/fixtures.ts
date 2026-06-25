/**
 * Static Index compiler protocol fixtures.
 *
 * These values exercise every currently supported Static Index method while
 * staying JSON-safe. They are intentionally small so TypeScript, Go, and Rust
 * tests can use the same payload classes without carrying large source files.
 *
 * @module
 */

import {
  STATIC_INDEX_COMPILER_PROTOCOL_VERSION,
  type StaticIndexCompilerRequest,
  type StaticIndexCompilerResponse,
  type StaticIndexPreparedPlan,
  type StaticIndexRunIdentity,
  type StaticIndexSourceFile,
  type StaticIndexTelemetry,
} from './schema'

/** Shared Static Index run identity fixture. */
export const staticIndexRunIdentityFixture = {
  protocolVersion: STATIC_INDEX_COMPILER_PROTOCOL_VERSION,
  compiler: { name: 'crux-indexer-worker', version: 'contract-spine' },
  oxc: { name: 'oxc_parser', version: '0.133.0' },
  primitiveManifest: { name: '@crux/indexer/primitives', version: 'phase-2', digest: 'sha256:primitives' },
  relationPolicy: { name: '@crux/indexer/relations', version: 'phase-2', digest: 'sha256:relations' },
  extensionManifests: [{ name: '@crux/indexer/crux-core', version: '0.1.0', digest: 'sha256:core' }],
  firstPartyGraphRules: { name: '@crux/indexer/rules', version: 'phase-2', digest: 'sha256:rules' },
  compilerProjection: { name: '@crux/indexer/compiler-projection', version: 'phase-2' },
} satisfies StaticIndexRunIdentity

/** Shared Static Index source file fixture. */
export const staticIndexSourceFileFixture = {
  file: '/repo/src/contract.ts',
  sourceHash: 'sha256:contract',
  cacheKey: 'static:/repo/src/contract.ts:contract',
} satisfies StaticIndexSourceFile

type StaticIndexParserInterestsFixture = Pick<
  StaticIndexPreparedPlan,
  'callNames' | 'callInterests' | 'constructorNames' | 'constructorInterests' | 'pruneNativeFactCallNames'
>

const staticIndexParserInterestsFixture = {
  callNames: ['agent', 'prompt'],
  callInterests: [
    {
      name: 'tool',
      importFrom: ['@crux/core'],
      configArg: 0,
      properties: ['id', 'handler'],
      callbacks: [{ property: 'handler', maxDepth: 2 }],
      source: 'manifest',
    },
  ],
  constructorNames: ['Agent'],
  constructorInterests: [
    {
      name: 'Agent',
      importFrom: ['@crux/core'],
      configArg: 0,
      properties: ['name', 'instructions'],
    },
  ],
  pruneNativeFactCallNames: ['router'],
} satisfies StaticIndexParserInterestsFixture

/** Prepared Static Index plan fixture shared by analyze and compile requests. */
export const staticIndexPreparedPlanFixture = {
  root: '/repo',
  projectName: 'contract-spine',
  files: [staticIndexSourceFileFixture],
  cacheHits: [],
  cacheMisses: [staticIndexSourceFileFixture],
  ...staticIndexParserInterestsFixture,
} satisfies StaticIndexPreparedPlan

/** Shared Static Index telemetry fixture. */
export const staticIndexTelemetryFixture = {
  node: { started: true, reasons: ['typescript-extension-host'] },
  nativeOnly: { eligible: false, reasons: ['extension host required'] },
  timings: [{ name: 'prepare', durationMs: 1.5, count: 1 }],
  files: { selected: 1, cacheHits: 0, cacheMisses: 1, analyzed: 1, skipped: 0 },
  cache: { readHits: 0, readMisses: 1, writes: 1, writeErrors: 0 },
  facts: {
    definitions: 1,
    relations: 0,
    sourceRefs: 0,
    diagnostics: 0,
    lintFindings: 0,
    ruleDescriptors: 0,
    sources: 1,
    sourceGraph: 1,
  },
} satisfies StaticIndexTelemetry

/** Request fixtures for every Static Index compiler method. */
export const staticIndexCompilerRequestFixtures = [
  {
    protocolVersion: STATIC_INDEX_COMPILER_PROTOCOL_VERSION,
    method: 'nativeStaticPrepare',
    root: '/repo',
    projectName: 'contract-spine',
    configPath: '/repo/crux.config.ts',
    identity: staticIndexRunIdentityFixture,
    files: [staticIndexSourceFileFixture],
    ...staticIndexParserInterestsFixture,
    cacheInputs: [{ name: 'static-parse', version: 'v1' }],
  },
  {
    protocolVersion: STATIC_INDEX_COMPILER_PROTOCOL_VERSION,
    method: 'nativeStaticAnalyze',
    stream: true,
    identity: staticIndexRunIdentityFixture,
    plan: staticIndexPreparedPlanFixture,
    files: [{ file: '/repo/src/contract.ts', sourceHash: 'sha256:contract', sourceText: 'export {}' }],
    extensionEvidenceInterests: { calls: ['prompt'] },
  },
  {
    protocolVersion: STATIC_INDEX_COMPILER_PROTOCOL_VERSION,
    method: 'nativeStaticFinalize',
    stream: true,
    identity: staticIndexRunIdentityFixture,
    nativeFacts: [{ kind: 'definitions', fact: { id: 'prompt:contract-spine' } }],
    extensionFacts: [],
    lintFacts: [
      {
        definitions: [
          {
            id: 'quality-target:contract-spine',
            kind: 'quality.target',
            name: 'contractSpine',
            fidelity: 'resolved',
            quality: { experimentIds: ['experiment:contract-spine'] },
          },
        ],
      },
    ],
    relationSpecs: { policies: [] },
    ruleResults: { findings: [] },
    patchPhase: 'quality',
    patchInvalidates: {},
    cache: { writes: [] },
  },
  {
    protocolVersion: STATIC_INDEX_COMPILER_PROTOCOL_VERSION,
    method: 'nativeStaticCompile',
    stream: true,
    identity: staticIndexRunIdentityFixture,
    plan: staticIndexPreparedPlanFixture,
    files: [{ file: '/repo/src/contract.ts', sourceHash: 'sha256:contract', sourceText: 'export {}' }],
    nativeFacts: [],
    extensionFacts: [],
    relationSpecs: { policies: [] },
    emitBuiltinLints: false,
  },
] satisfies readonly StaticIndexCompilerRequest[]

/** Response fixtures for every Static Index compiler method. */
export const staticIndexCompilerResponseFixtures = [
  {
    protocolVersion: STATIC_INDEX_COMPILER_PROTOCOL_VERSION,
    method: 'nativeStaticPrepare',
    plan: staticIndexPreparedPlanFixture,
    diagnostics: [],
    telemetry: staticIndexTelemetryFixture,
  },
  {
    protocolVersion: STATIC_INDEX_COMPILER_PROTOCOL_VERSION,
    method: 'nativeStaticAnalyze',
    facts: [],
    diagnostics: [],
    extensionEvidenceJobs: [],
    telemetry: staticIndexTelemetryFixture,
  },
  {
    protocolVersion: STATIC_INDEX_COMPILER_PROTOCOL_VERSION,
    method: 'nativeStaticFinalize',
    events: [],
    telemetry: staticIndexTelemetryFixture,
  },
  {
    protocolVersion: STATIC_INDEX_COMPILER_PROTOCOL_VERSION,
    method: 'nativeStaticCompile',
    events: [],
    telemetry: staticIndexTelemetryFixture,
  },
] satisfies readonly StaticIndexCompilerResponse[]
