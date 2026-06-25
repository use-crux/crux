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
import { readNativeRuntimeSharedFixture } from '../indexer/contracts/fixtures'

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
    const fixture = readNativeRuntimeSharedFixture('native-static-protocol')

    expect(fixture.requests.map((request) => request.method)).toEqual([
      'nativeStaticPrepare',
      'nativeStaticAnalyze',
      'nativeStaticFinalize',
      'nativeStaticCompile',
    ])
    expect(fixture.responses.map((response) => response.method)).toEqual([
      'nativeStaticPrepare',
      'nativeStaticAnalyze',
      'nativeStaticFinalize',
      'nativeStaticCompile',
    ])

    for (const request of fixture.requests) {
      expect(StaticIndexCompilerRequestSchema.parse(request)).toEqual(request)
      expect(parseStaticIndexCompilerRequest(JSON.stringify(request))).toEqual({ ok: true, request })
    }
    for (const response of fixture.responses) {
      expect(StaticIndexCompilerResponseSchema.parse(response)).toEqual(response)
    }
  })

  it('rejects malformed Static Index compiler requests', () => {
    expect(parseStaticIndexCompilerRequest('{')).toEqual({ ok: false, error: 'invalid JSON' })
    expect(
      parseStaticIndexCompilerRequest(
        JSON.stringify({
          protocolVersion: 2,
          method: 'nativeStaticPrepare',
          root: '/repo',
          identity: staticIndexRunIdentityFixture,
          files: [],
        }),
      ),
    ).toMatchObject({ ok: false })
  })
})
