import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { IndexPatchFacts } from '../src/indexer/patches'
import {
  createNativeSemanticBackend,
  createSemanticIndexService,
  createTypeScriptSemanticBackend,
} from '../src/indexer/semantic/service'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('MCP semantic backend parity', () => {
  it('resolves direct and conditional server composition plus expected tools', async () => {
    const root = await fixtureRoot()
    const file = join(root, 'src/mcp.ts')
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'Bundler',
          target: 'ES2022',
          noEmit: true,
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      }),
    )
    await writeFile(
      file,
      `
        import { context, match, prompt, when } from '@use-crux/core'
        import { mcp, stdio } from '@use-crux/mcp'

        export const searchServer = mcp({
          id: 'search',
          transport: stdio({
            command: 'search-server',
            env: { MCP_TOKEN: 'SECRET_MCP_SEMANTIC_TOKEN' },
          }),
          tools: { allow: ['lookup', 'summarize'], prefix: 'search_' },
        })

        export const researchContext = context({
          id: 'research',
          use: [when(() => true, searchServer)],
        })

        export const writerPrompt = prompt({
          id: 'writer',
          use: [
            searchServer,
            match({
              cases: { research: searchServer },
              default: researchContext,
            }),
          ],
        })
      `,
    )

    const typescript = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: 'disabled' }),
    }).indexFiles({ root, files: [file] })
    const native = await createSemanticIndexService({
      backend: createNativeSemanticBackend({ cache: 'disabled' }),
    }).indexFiles({ root, files: [file] })

    expect(typescript.status).toBe('ok')
    expect(native.status).toBe('ok')
    expect(normalized(native.facts)).toEqual(normalized(typescript.facts))
    expect(JSON.stringify(typescript.facts)).not.toContain('SECRET_MCP_SEMANTIC_TOKEN')
    expect(relationTriples(typescript.facts)).toEqual(
      expect.arrayContaining([
        ['context.uses_mcp_server', 'context:research:use:1', 'mcp.server:search'],
        ['prompt.uses_mcp_server', 'prompt:writer:use:1', 'mcp.server:search'],
        ['mcp.server.provides_tool', 'mcp.server:search', 'tool:search_lookup'],
        ['mcp.server.provides_tool', 'mcp.server:search', 'tool:search_summarize'],
      ]),
    )
    expect(
      typescript.facts.definitions?.find((definition) => definition.id === 'context:research')?.metadata?.facts,
    ).toMatchObject({
      useEntries: [
        expect.objectContaining({
          targetDefinitionId: 'mcp.server:search',
          targetKind: 'mcp.server',
          relationType: 'context.uses_mcp_server',
          conditionality: 'when',
          via: 'when',
        }),
      ],
    })
  }, 30_000)

  it('projects simple MCP composition through the native direct manifest', async () => {
    const root = await fixtureRoot()
    const file = join(root, 'src/direct.ts')
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'Bundler',
          target: 'ES2022',
          noEmit: true,
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      }),
    )
    await writeFile(
      file,
      `
        import { context, prompt } from '@use-crux/core'
        import { mcp, stdio } from '@use-crux/mcp'

        export const searchServer = mcp({
          id: 'search',
          transport: stdio({ command: 'search-server' }),
          tools: { allow: ['lookup'], prefix: 'search_' },
        })
        export const researchContext = context({ id: 'research', use: [searchServer] })
        export const writerPrompt = prompt({ id: 'writer', use: [searchServer] })
      `,
    )
    const timingNames: string[] = []
    const coverageExtractors: string[][] = []
    const typescript = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: 'disabled' }),
    }).indexFiles({ root, files: [file] })
    const native = await createSemanticIndexService({
      backend: createNativeSemanticBackend({ cache: 'disabled' }),
    }).indexFiles({
      root,
      files: [file],
      semanticInstrumentation: {
        onTiming: (timing) => timingNames.push(timing.name),
        onNativeCoverage: (coverage) =>
          coverageExtractors.push('extractors' in coverage ? [...coverage.extractors] : []),
      },
    })

    expect(normalized(native.facts)).toEqual(normalized(typescript.facts))
    expect(timingNames).toContain('semantic.native.extractor.direct_crux')
    expect(timingNames).not.toContain('semantic.native.analyzer.shared')
    expect(coverageExtractors).toEqual([['crux.direct-crux']])
    expect(relationTriples(native.facts)).toEqual(
      expect.arrayContaining([
        ['context.uses_mcp_server', 'context:research:use:1', 'mcp.server:search'],
        ['prompt.uses_mcp_server', 'prompt:writer:use:1', 'mcp.server:search'],
        ['mcp.server.provides_tool', 'mcp.server:search', 'tool:search_lookup'],
      ]),
    )
  }, 30_000)
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-mcp-semantic-'))
  roots.push(root)
  return root
}

function relationTriples(facts: IndexPatchFacts): readonly (readonly [string, string, string])[] {
  return (facts.relations ?? []).map((relation) => [relation.type, relation.from, relation.to])
}

function normalized(facts: IndexPatchFacts): IndexPatchFacts {
  return {
    definitions: sort(facts.definitions),
    sourceRefs: sort(facts.sourceRefs),
    relations: sort(facts.relations),
    diagnostics: sort(facts.diagnostics),
    lintFindings: sort(facts.lintFindings),
    sources: sort(facts.sources),
    sourceGraph: facts.sourceGraph,
  }
}

function sort<T>(rows: readonly T[] | undefined): T[] | undefined {
  return rows ? [...rows].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))) : undefined
}
