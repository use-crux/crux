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
