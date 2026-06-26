import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { IndexPatchFacts } from '../indexer/patches'
import {
  createNativeSemanticBackend,
  createSemanticIndexService,
  createTypeScriptSemanticBackend,
} from '../indexer/semantic/service'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-semantic-native-declaration-range-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('native semantic declaration range parity', () => {
  it('matches TypeScript when native declaration handles differ from TypeScript AST ranges', async () => {
    const root = await fixtureRoot()
    await writeTsconfig(root)
    const file = join(root, 'src/runtime.ts')
    const contextsFile = join(root, 'src/contexts.ts')
    const promptFile = join(root, 'src/prompt.ts')
    await writeFile(
      file,
      `
        import { blackboard } from '@use-crux/core/agent'
        import { facts, memory, memoryBlock, workingState, type MemoryRuntimeOptions } from '@use-crux/convex/memory'
        import { z } from 'zod'

        function createMemoryId(kind: string, id: string): string {
          return kind + ':' + id
        }

        // Native-preview handle offsets must survive non-ASCII text before declarations: —
        const stringList = z.preprocess((value) => {
          if (typeof value === 'string') return [value]
          return value
        }, z.array(z.string()).default([]))

        const threadBlackboardSchema = z.object({
          // Coordinator namespace.
          constraints: stringList,
          pendingActions: stringList,
          decisions: stringList,
          researchFindings: z.object({
            synthesis: z.string(),
            keyFindings: z.array(z.string()),
          }).optional(),
        })

        export function createThreadBlackboard(threadId: string) {
          return blackboard({
            id: createMemoryId('blackboard', threadId),
            schema: threadBlackboardSchema,
          })
        }

        export function createSessionMemory(threadId: string) {
          const memoryId = createMemoryId('session', threadId)
          const runtime = { memoryId } satisfies Pick<MemoryRuntimeOptions, 'memoryId'>
          const state = workingState({ id: 'state', schema: threadBlackboardSchema })
          const tools = memoryBlock({
            id: 'session-tools',
            kind: 'working',
            tools: () => ({ runtime }),
          })
          const knowledge = facts({
            id: 'facts',
            render: async () => '',
          })
          return memory({
            id: memoryId,
            blocks: [state, tools, knowledge],
          })
        }

        export function createProjectMemory(projectId: string) {
          const memoryId = createMemoryId('semantic', projectId)
          const projectFacts = facts({ id: 'project-facts' })
          return memory({
            id: memoryId,
            blocks: [projectFacts],
          })
        }
      `,
    )
    await writeFile(
      contextsFile,
      `
        import { context } from '@use-crux/core'

        export const currentDate = context({ id: 'current-date' })
      `,
    )
    await writeFile(
      promptFile,
      `
        import { prompt } from '@use-crux/core'
        import { currentDate } from './contexts'

        // Native-preview identifier offsets must also work for imported use targets: —
        export const dailyPrompt = prompt({
          id: 'daily',
          use: [currentDate],
        })
      `,
    )

    const typescriptPatch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: 'disabled' }),
    }).indexFiles({ root, files: [file, contextsFile, promptFile] })
    const nativePatch = await createSemanticIndexService({
      backend: createNativeSemanticBackend({ cache: 'disabled' }),
    }).indexFiles({ root, files: [file, contextsFile, promptFile] })

    expect(typescriptPatch.status).toBe('ok')
    expect(nativePatch.status).toBe('ok')
    expect(definitionIds(typescriptPatch.facts)).toEqual(
      expect.arrayContaining([
        'blackboard:thread',
        'prompt:daily',
        'memory.block:memoryId:facts',
        'memory.block:memoryId:project-facts',
        'memory.block:memoryId:session-tools',
        'memory.block:memoryId:state',
      ]),
    )
    expect(memoryBlockCount(typescriptPatch.facts)).toBe(4)
    expect(relationTypes(typescriptPatch.facts)).toContain('prompt.uses_context')
    expect(normalizedFacts(nativePatch.facts)).toEqual(normalizedFacts(typescriptPatch.facts))
  }, 20_000)
})

async function writeTsconfig(root: string): Promise<void> {
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
}

function definitionIds(facts: IndexPatchFacts): readonly string[] {
  return [...new Set((facts.definitions ?? []).map((definition) => definition.id))].sort()
}

function memoryBlockCount(facts: IndexPatchFacts): number | undefined {
  const metadata = facts.definitions?.find((definition) => definition.id === 'memory:memoryId')?.metadata
  return typeof metadata?.blockCount === 'number' ? metadata.blockCount : undefined
}

function relationTypes(facts: IndexPatchFacts): readonly string[] {
  return [...new Set((facts.relations ?? []).map((relation) => relation.type))].sort()
}

function normalizedFacts(facts: IndexPatchFacts): IndexPatchFacts {
  return {
    definitions: sortJsonRows(facts.definitions),
    sourceRefs: sortJsonRows(facts.sourceRefs),
    relations: sortJsonRows(facts.relations),
    diagnostics: sortJsonRows(facts.diagnostics),
    lintFindings: sortJsonRows(facts.lintFindings),
    sources: sortJsonRows(facts.sources),
    sourceGraph: facts.sourceGraph,
  }
}

function sortJsonRows<T>(rows: readonly T[] | undefined): T[] | undefined {
  return rows ? [...rows].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))) : undefined
}
