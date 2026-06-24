import { describe, expect, it } from 'vitest'
import {
  NATIVE_STATIC_COMPILER_PROTOCOL_VERSION,
  NativeStaticCompilerRequestSchema,
  NativeStaticCompilerResponseSchema,
  parseNativeStaticCompilerRequest,
  type NativeStaticCompilerRequest,
  type NativeStaticCompilerResponse,
  type NativeStaticRunIdentity,
  type NativeStaticTelemetry,
} from '../indexer/worker-protocol'

describe('native static compiler protocol', () => {
  it('validates native static compiler requests and responses as JSON fixtures', () => {
    const identity = nativeStaticRunIdentity()
    const telemetry = nativeStaticTelemetry()
    const sourceFile = {
      file: '/repo/src/writer.ts',
      sourceHash: 'sha256:writer',
      cacheKey: 'static:/repo/src/writer.ts:writer',
    }
    const parserInterests = {
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
    }
    const preparePlan = {
      root: '/repo',
      projectName: 'fixture',
      files: [sourceFile],
      cacheHits: [],
      cacheMisses: [sourceFile],
      ...parserInterests,
    }
    const requests = [
      {
        protocolVersion: NATIVE_STATIC_COMPILER_PROTOCOL_VERSION,
        method: 'nativeStaticPrepare',
        root: '/repo',
        projectName: 'fixture',
        configPath: '/repo/crux.config.ts',
        identity,
        files: [sourceFile],
        ...parserInterests,
        cacheInputs: [{ name: 'static-parse', version: 'v1' }],
      },
      {
        protocolVersion: NATIVE_STATIC_COMPILER_PROTOCOL_VERSION,
        method: 'nativeStaticAnalyze',
        stream: true,
        identity,
        plan: preparePlan,
        files: [{ file: '/repo/src/writer.ts', sourceHash: 'sha256:writer', sourceText: 'export {}' }],
        extensionEvidenceInterests: { calls: ['prompt'] },
      },
      {
        protocolVersion: NATIVE_STATIC_COMPILER_PROTOCOL_VERSION,
        method: 'nativeStaticFinalize',
        stream: true,
        identity,
        nativeFacts: [{ kind: 'definitions', fact: { id: 'prompt:writer' } }],
        extensionFacts: [],
        lintFacts: [
          {
            definitions: [
              {
                id: 'quality-target:writer',
                kind: 'quality.target',
                name: 'writer',
                fidelity: 'resolved',
                quality: { experimentIds: ['experiment:writer'] },
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
        protocolVersion: NATIVE_STATIC_COMPILER_PROTOCOL_VERSION,
        method: 'nativeStaticCompile',
        stream: true,
        identity,
        plan: preparePlan,
        files: [{ file: '/repo/src/writer.ts', sourceHash: 'sha256:writer', sourceText: 'export {}' }],
        nativeFacts: [],
        extensionFacts: [],
        relationSpecs: { policies: [] },
        emitBuiltinLints: false,
      },
    ] satisfies readonly NativeStaticCompilerRequest[]
    const responses = [
      {
        protocolVersion: NATIVE_STATIC_COMPILER_PROTOCOL_VERSION,
        method: 'nativeStaticPrepare',
        plan: preparePlan,
        diagnostics: [],
        telemetry,
      },
      {
        protocolVersion: NATIVE_STATIC_COMPILER_PROTOCOL_VERSION,
        method: 'nativeStaticAnalyze',
        facts: [],
        diagnostics: [],
        extensionEvidenceJobs: [],
        telemetry,
      },
      {
        protocolVersion: NATIVE_STATIC_COMPILER_PROTOCOL_VERSION,
        method: 'nativeStaticFinalize',
        events: [],
        telemetry,
      },
      {
        protocolVersion: NATIVE_STATIC_COMPILER_PROTOCOL_VERSION,
        method: 'nativeStaticCompile',
        events: [],
        telemetry,
      },
    ] satisfies readonly NativeStaticCompilerResponse[]

    for (const request of requests) {
      const json = JSON.parse(JSON.stringify(request))
      expect(NativeStaticCompilerRequestSchema.parse(json)).toEqual(json)
      expect(parseNativeStaticCompilerRequest(JSON.stringify(request))).toEqual({ ok: true, request: json })
    }
    for (const response of responses) {
      const json = JSON.parse(JSON.stringify(response))
      expect(NativeStaticCompilerResponseSchema.parse(json)).toEqual(json)
    }
  })

  it('rejects malformed native static compiler requests', () => {
    expect(parseNativeStaticCompilerRequest('{')).toEqual({ ok: false, error: 'invalid JSON' })
    expect(
      parseNativeStaticCompilerRequest(
        JSON.stringify({
          protocolVersion: 2,
          method: 'nativeStaticPrepare',
          root: '/repo',
          identity: nativeStaticRunIdentity(),
          files: [],
        }),
      ),
    ).toMatchObject({ ok: false })
  })
})

function nativeStaticRunIdentity(): NativeStaticRunIdentity {
  return {
    protocolVersion: NATIVE_STATIC_COMPILER_PROTOCOL_VERSION,
    compiler: { name: 'crux-indexer-worker', version: 'test' },
    oxc: { name: 'oxc_parser', version: '0.133.0' },
    primitiveManifest: { name: '@crux/indexer/primitives', version: 'phase-2', digest: 'sha256:primitives' },
    relationPolicy: { name: '@crux/indexer/relations', version: 'phase-2', digest: 'sha256:relations' },
    extensionManifests: [{ name: '@crux/indexer/crux-core', version: '0.1.0', digest: 'sha256:core' }],
    firstPartyGraphRules: { name: '@crux/indexer/rules', version: 'phase-2', digest: 'sha256:rules' },
    compilerProjection: { name: '@crux/indexer/compiler-projection', version: 'phase-2' },
  }
}

function nativeStaticTelemetry(): NativeStaticTelemetry {
  return {
    node: { started: true, reasons: ['typescript-bundled-extractor'] },
    nativeOnly: { eligible: false, reasons: ['bundled extractor not native-covered'] },
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
  }
}
