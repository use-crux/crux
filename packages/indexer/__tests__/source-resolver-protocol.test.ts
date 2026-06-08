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
  })

  it('serializes responses as one JSON line', () => {
    expect(serializeSourceResolverWorkerResponse({ error: 'bad input' })).toBe('{"error":"bad input"}\n')
  })
})
