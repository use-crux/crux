import { compositionDefinitionRef } from '@use-crux/core/observability'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createNativeSemanticBackend,
  createSemanticIndexService,
  createTypeScriptSemanticBackend,
} from '../src/indexer/semantic/service'
import {
  extractNativeAndFallback,
  itWithRustOxc,
  nativeFactCount,
} from './native-first-party-fixture-helpers'

// `id` is a required authored field on every composition primitive. The static
// (Rust/Oxc native) frontend emits the canonical `composition.<kind>` definition
// and the semantic backends emit its relations. Neither may fall back to the
// local variable name for a composition that lacks a direct string `id`, or a
// runtime span would join an anonymous, misleading canonical id that no real
// definition backs.
const idlessLocalName = 'anon'

describe('composition extraction requires an authored id (native static)', () => {
  itWithRustOxc(
    'emits the composition definition only for the authored-id composition',
    async () => {
      const source = [
        "import { agent, prompt } from '@use-crux/core'",
        "import { parallel } from '@use-crux/ai'",
        '',
        "export const writerPrompt = prompt({ id: 'writer', prompt: 'Write' })",
        "export const writerAgent = agent({ id: 'writer-agent', prompt: writerPrompt })",
        '',
        // No `id`: the removed anonymous fallback would have keyed this to the
        // `anon` local variable name (`composition.parallel:anon`).
        `export const ${idlessLocalName} = parallel({`,
        '  agents: { writer: writerAgent },',
        '  context: {},',
        '})',
        '',
        // Control: an authored id still produces the canonical definition, so the
        // populated path is proven — not merely an empty extraction.
        "export const named = parallel({ id: 'Named Parallel!', agents: { writer: writerAgent }, context: {} })",
      ].join('\n')
      const { nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['prompt', 'agent', 'parallel'],
      })

      // Exactly one composition native fact / definition — the id-ful control.
      expect(nativeFactCount(record, 'composition')).toBe(1)
      const compositionIds = nativeOut.definitions
        .filter((definition) => definition.kind === 'composition.parallel')
        .map((definition) => definition.id)
      expect(compositionIds).toEqual([
        compositionDefinitionRef('parallel', 'Named Parallel!').id,
      ])
      expect(compositionIds).not.toContain(
        `composition.parallel:${idlessLocalName}`,
      )
    },
    30_000,
  )
})

describe('composition extraction requires an authored id (semantic backends)', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  async function writeProject(): Promise<{ root: string; files: string[] }> {
    const root = await mkdtemp(join(tmpdir(), '.tmp-composition-authored-id-'))
    roots.push(root)
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
    const files: Record<string, string> = {
      'src/index.ts': [
        "import { agent, prompt } from '@use-crux/core'",
        "import { parallel } from '@use-crux/ai'",
        '',
        "export const writerPrompt = prompt({ id: 'writer', prompt: 'Write' })",
        "export const writerAgent = agent({ id: 'writer-agent', prompt: writerPrompt })",
        '',
        `export const ${idlessLocalName} = parallel({`,
        '  agents: { writer: writerAgent },',
        '  context: {},',
        '})',
        '',
        "export const named = parallel({ id: 'Named Parallel!', agents: { writer: writerAgent }, context: {} })",
      ].join('\n'),
    }
    const written: string[] = []
    for (const [path, source] of Object.entries(files)) {
      const file = join(root, path)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, source)
      written.push(file)
    }
    return { root, files: written }
  }

  it('keys composition relations only to the authored id on both backends', async () => {
    const { root, files } = await writeProject()
    const typescriptPatch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: 'disabled' }),
    }).indexFiles({ root, files })
    const nativePatch = await createSemanticIndexService({
      backend: createNativeSemanticBackend({ cache: 'disabled' }),
    }).indexFiles({ root, files })

    expect(typescriptPatch.status).toBe('ok')
    expect(nativePatch.status).toBe('ok')

    const namedId = compositionDefinitionRef('parallel', 'Named Parallel!').id
    for (const [label, patch] of [
      ['typescript', typescriptPatch],
      ['native', nativePatch],
    ] as const) {
      const compositionRelations = (patch.facts.relations ?? []).filter((relation) =>
        relation.from.startsWith('composition.parallel:'),
      )
      // The id-ful control still emits its composition relations…
      expect(
        compositionRelations.some((relation) => relation.from.startsWith(namedId)),
        `${label} named composition relations`,
      ).toBe(true)
      // …but nothing is ever keyed to the id-less local variable name.
      expect(
        compositionRelations.map((relation) => relation.from),
        `${label} anonymous composition relations`,
      ).not.toContain(`composition.parallel:${idlessLocalName}`)
      for (const relation of compositionRelations) {
        expect(relation.from.startsWith(`${namedId}`)).toBe(true)
      }
    }
  }, 30_000)
})
