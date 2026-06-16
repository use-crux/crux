import { describe, expect, it } from 'vitest'
import { parseSourceResolverWorkerRequest, serializeSourceResolverWorkerResponse } from '../source-resolver/protocol'

describe('source resolver worker protocol', () => {
  it('parses resolveLocations requests through type guards', () => {
    expect(
      parseSourceResolverWorkerRequest(
        JSON.stringify({
          method: 'resolveLocations',
          locations: [{ file: '/bundle.js', line: 1, column: 0, function: 'writer' }],
        }),
      ),
    ).toEqual({
      ok: true,
      request: {
        method: 'resolveLocations',
        locations: [{ file: '/bundle.js', line: 1, column: 0, function: 'writer' }],
      },
    })
  })

  it('parses resolveFnSource requests with optional columns', () => {
    expect(parseSourceResolverWorkerRequest('{"method":"resolveFnSource","file":"/bundle.js","line":1}')).toEqual({
      ok: true,
      request: { method: 'resolveFnSource', file: '/bundle.js', line: 1, column: undefined },
    })
  })

  it('parses resolveSourceFrame requests with source-frame options', () => {
    expect(
      parseSourceResolverWorkerRequest(
        JSON.stringify({
          method: 'resolveSourceFrame',
          file: '/bundle.js',
          line: 1,
          column: 0,
          sourceRef: '/bundle.js:1:0',
          frameRadius: 2,
          role: 'failed',
          capturedAt: '2026-06-15T12:00:00.000Z',
        }),
      ),
    ).toEqual({
      ok: true,
      request: {
        method: 'resolveSourceFrame',
        file: '/bundle.js',
        line: 1,
        column: 0,
        sourceRef: '/bundle.js:1:0',
        frameRadius: 2,
        role: 'failed',
        capturedAt: '2026-06-15T12:00:00.000Z',
      },
    })
  })

  it('returns JSON-safe errors for malformed or invalid requests', () => {
    expect(parseSourceResolverWorkerRequest('{')).toEqual({ ok: false, error: 'invalid JSON' })
    expect(parseSourceResolverWorkerRequest('{"method":"missing"}')).toEqual({
      ok: false,
      error: 'unknown method: missing',
    })
    expect(parseSourceResolverWorkerRequest('{"method":"resolveLocations","locations":[{"file":1}]}')).toEqual({
      ok: false,
      error: 'resolveLocations requires locations',
    })
    expect(
      parseSourceResolverWorkerRequest('{"method":"resolveSourceFrame","file":"/bundle.js","line":1,"role":"bad"}'),
    ).toEqual({
      ok: false,
      error: 'resolveSourceFrame role is invalid',
    })
  })

  it('serializes responses as one JSON line', () => {
    expect(serializeSourceResolverWorkerResponse({ error: 'bad input' })).toBe('{"error":"bad input"}\n')
  })
})
