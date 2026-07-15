import { describe, expect } from 'vitest'
import { mcpStaticFixtureSource } from './mcp-static-fixture'
import { mcpPrimitiveManifest } from '../src/indexer/mcp/primitive-manifest'
import { nativeFinalizeFactsFromExtractionResults } from '../src/indexer/static-index/extension-host/evidence/host-facts'
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
    const fallbackDefinition = result.fallbackOut.definitions.find(
      (definition) => definition.kind === 'mcp.server',
    )
    expect(fallbackDefinition).toBeDefined()
    const hostFacts = nativeFinalizeFactsFromExtractionResults([
      {
        kind: 'matched',
        extension: {
          name: mcpPrimitiveManifest.name,
          version: mcpPrimitiveManifest.version,
        },
        extractor: 'mcp.server',
        dependencies: [],
        diagnostics: [],
        facts: {
          definitions: [
            {
              variableName: 'server',
              definition: fallbackDefinition!,
            },
          ],
        },
      },
    ])
    const nativeAttribution = result.record.nativeFacts?.[0]?.replaces?.map(
      ({ extractor }) => ({ name: extractor }),
    )
    expect(nativeAttribution).toEqual([{ name: 'mcp.server' }])
    expect(hostFacts.definitionExtractors?.[fallbackDefinition!.id]).toEqual(
      nativeAttribution,
    )
    expect(JSON.stringify(result.nativeOut)).not.toMatch(
      /SECRET_|password|private-server|private\/workspace|Authorization/,
    )
  })
})
