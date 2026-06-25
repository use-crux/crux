import { describe, expect, it } from 'vitest'
import {
  StaticIndexCompilerRequestSchema,
  StaticIndexCompilerResponseSchema,
  parseStaticIndexCompilerRequest,
} from '../indexer/contracts/static-index/schema'
import {
  staticIndexCompilerRequestFixtures,
  staticIndexCompilerResponseFixtures,
  staticIndexRunIdentityFixture,
} from '../indexer/contracts/static-index/fixtures'
import { readStaticIndexRuntimeSharedFixture } from '../indexer/contracts/fixtures'

describe('Static Index compiler protocol', () => {
  it('validates Static Index compiler requests and responses as JSON fixtures', () => {
    for (const request of staticIndexCompilerRequestFixtures) {
      const json = JSON.parse(JSON.stringify(request))
      expect(StaticIndexCompilerRequestSchema.parse(json)).toEqual(json)
      expect(parseStaticIndexCompilerRequest(JSON.stringify(request))).toEqual({ ok: true, request: json })
    }
    for (const response of staticIndexCompilerResponseFixtures) {
      const json = JSON.parse(JSON.stringify(response))
      expect(StaticIndexCompilerResponseSchema.parse(json)).toEqual(json)
    }
  })

  it('validates the shared Static Index protocol fixture file', () => {
    const fixture = readStaticIndexRuntimeSharedFixture('static-index-protocol')

    expect(fixture.requests.map((request) => request.method)).toEqual([
      'staticIndexPrepare',
      'staticIndexAnalyze',
      'staticIndexFinalize',
      'staticIndexCompile',
    ])
    expect(fixture.responses.map((response) => response.method)).toEqual([
      'staticIndexPrepare',
      'staticIndexAnalyze',
      'staticIndexFinalize',
      'staticIndexCompile',
    ])

    for (const request of fixture.requests) {
      expect(StaticIndexCompilerRequestSchema.parse(request)).toEqual(request)
      expect(parseStaticIndexCompilerRequest(JSON.stringify(request))).toEqual({ ok: true, request })
    }
    for (const response of fixture.responses) {
      expect(StaticIndexCompilerResponseSchema.parse(response)).toEqual(response)
    }
  })

  it('uses the shared Static Index identity manifest for every protocol request', () => {
    const manifest = readStaticIndexRuntimeSharedFixture('static-index-identity')
    const fixture = readStaticIndexRuntimeSharedFixture('static-index-protocol')

    expect(manifest).toMatchObject({
      protocolVersion: 1,
      oxcFrontend: { name: expect.any(String), version: expect.any(String) },
      primitiveManifest: { digest: expect.any(String) },
      relationPolicy: { digest: expect.any(String) },
      ruleDescriptors: { digest: expect.any(String) },
      compilerProjection: { digest: expect.any(String) },
    })
    for (const request of fixture.requests) {
      expect(request.identity).toMatchObject({
        protocolVersion: manifest.protocolVersion,
        oxc: manifest.oxcFrontend,
        primitiveManifest: manifest.primitiveManifest,
        relationPolicy: manifest.relationPolicy,
        ruleDescriptors: manifest.ruleDescriptors,
        compilerProjection: manifest.compilerProjection,
      })
    }
  })

  it('rejects malformed Static Index compiler requests', () => {
    expect(parseStaticIndexCompilerRequest('{')).toEqual({ ok: false, error: 'invalid JSON' })
    expect(
      parseStaticIndexCompilerRequest(
        JSON.stringify({
          protocolVersion: 2,
          method: 'staticIndexPrepare',
          root: '/repo',
          identity: staticIndexRunIdentityFixture,
          files: [],
        }),
      ),
    ).toMatchObject({ ok: false })
  })
})
