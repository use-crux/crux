import { describe, expect } from 'vitest'
import { mcpStaticFixtureSource } from './mcp-static-fixture'
import {
  expectNativeExtractionParity,
  extractNativeAndFallback,
  itWithRustOxc,
  nativeFactCount,
} from './native-first-party-fixture-helpers'

describe('authored MCP native static parity', () => {
  itWithRustOxc('matches the shared secret-safe authored-server fixture', async () => {
    const result = await extractNativeAndFallback({
      callNames: ['mcp', 'stdio', 'streamableHttp'],
      source: mcpStaticFixtureSource,
    })

    expect(nativeFactCount(result.record, 'mcp.server')).toBe(5)
    expectNativeExtractionParity(result.nativeOut, result.fallbackOut)
    expect(result.nativeOut.definitions.filter((definition) => definition.kind === 'mcp.server')).toHaveLength(5)
    expect(JSON.stringify(result.nativeOut)).not.toMatch(
      /SECRET_|password|private-server|private\/workspace|Authorization/,
    )
  })
})
