import { describe, expect, it } from 'vitest'
import {
  NativeStaticCompilerRequestSchema,
  NativeStaticCompilerResponseSchema,
  parseNativeStaticCompilerRequest,
} from '../indexer/contracts/native-static/schema'
import {
  nativeStaticCompilerRequestFixtures,
  nativeStaticCompilerResponseFixtures,
  nativeStaticRunIdentityFixture,
} from '../indexer/contracts/native-static/fixtures'
import { readNativeRuntimeSharedFixture } from '../indexer/contracts/fixtures'

describe('native static compiler protocol', () => {
  it('validates native static compiler requests and responses as JSON fixtures', () => {
    for (const request of nativeStaticCompilerRequestFixtures) {
      const json = JSON.parse(JSON.stringify(request))
      expect(NativeStaticCompilerRequestSchema.parse(json)).toEqual(json)
      expect(parseNativeStaticCompilerRequest(JSON.stringify(request))).toEqual({ ok: true, request: json })
    }
    for (const response of nativeStaticCompilerResponseFixtures) {
      const json = JSON.parse(JSON.stringify(response))
      expect(NativeStaticCompilerResponseSchema.parse(json)).toEqual(json)
    }
  })

  it('validates the shared native static protocol fixture file', () => {
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
      expect(NativeStaticCompilerRequestSchema.parse(request)).toEqual(request)
      expect(parseNativeStaticCompilerRequest(JSON.stringify(request))).toEqual({ ok: true, request })
    }
    for (const response of fixture.responses) {
      expect(NativeStaticCompilerResponseSchema.parse(response)).toEqual(response)
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
          identity: nativeStaticRunIdentityFixture,
          files: [],
        }),
      ),
    ).toMatchObject({ ok: false })
  })
})
