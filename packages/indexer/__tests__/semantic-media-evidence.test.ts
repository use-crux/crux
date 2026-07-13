import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createSemanticIndexService,
  createTypeScriptSemanticBackend,
} from '../src/indexer/semantic/service'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('semantic authored-media evidence', () => {
  it('resolves imported aliases, local option bindings, routing, and deterministic misuse evidence', async () => {
    const root = await fixtureRoot()
    const file = join(root, 'media.ts')
    await writeFile(
      file,
      [
        `import { generate, generateImage as image } from '@use-crux/ai'`,
        `import { prompt, router } from '@use-crux/core'`,
        `import { createOpenAI } from '@use-crux/openai'`,
        `import type { ImageModel, LanguageModel } from 'ai'`,
        `import type OpenAI from 'openai'`,
        `declare const client: OpenAI`,
        `declare const imageModel: ImageModel`,
        `declare const languageModel: LanguageModel`,
        `const openai = createOpenAI(client)`,
        `const render = image`,
        `const generateImage = (input: unknown) => input`,
        `export const fake = generateImage({ prompt: 'not crux' })`,
        `const visionPrompt = prompt({ id: 'vision-prompt' })`,
        `const route = router({ id: 'vision-route', classify: () => 'vision' as const, routes: { vision: languageModel, default: languageModel } })`,
        `const options = { model: imageModel, n: 2, size: '1024x1024' as const }`,
        `export const cover = render(options)`,
        `export const unsafe = openai.generate(visionPrompt, { model: 'gpt-4o', messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'provider-file', provider: 'google', fileId: 'private-file-id' } }] }] })`,
        `export const routed = generate(visionPrompt, { model: route, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'asset-ref', ref: { uri: 'private-ref' } } }] }] })`,
        `export const unknown = generate(visionPrompt, { model: route, messages: dynamicMessages })`,
        `void unsafe.content`,
        `void routed.content`,
      ].join('\n'),
    )

    const patch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: 'disabled' }),
    }).indexProject({ root, semanticBackend: 'typescript' })
    expect(patch.status).toBe('ok')
    const facts = patch.facts
    const cover = facts.definitions?.find(
      (definition) => definition.id === 'media.operation:cover',
    )
    const unsafe = facts.definitions?.find(
      (definition) => definition.id === 'media.operation:unsafe',
    )
    const routed = facts.definitions?.find(
      (definition) => definition.id === 'media.operation:routed',
    )

    expect(cover?.metadata?.facts).toEqual({
      kind: 'media.operation',
      operation: 'generateImage',
      outputModalities: ['image'],
      adapter: 'ai-sdk',
      execution: 'unknown',
      authoredOptions: { n: 2, size: '1024x1024' },
    })
    expect(unsafe?.metadata?.facts).toMatchObject({
      kind: 'media.operation',
      operation: 'generate',
      inputModalities: ['image'],
      adapter: 'openai',
      model: 'gpt-4o',
    })
    expect(routed?.metadata?.facts).toMatchObject({
      kind: 'media.operation',
      operation: 'generate',
      inputModalities: ['image'],
      adapter: 'ai-sdk',
    })
    expect(
      facts.definitions?.some(
        (definition) => definition.id === 'media.operation:unknown',
      ),
    ).toBe(false)
    expect(
      facts.definitions?.some(
        (definition) => definition.id === 'media.operation:fake',
      ),
    ).toBe(false)
    expect(facts.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'media.uses_prompt',
          from: 'media.operation:unsafe',
          to: 'prompt:vision-prompt',
        }),
        expect.objectContaining({
          type: 'media.uses_prompt',
          from: 'media.operation:routed',
          to: 'prompt:vision-prompt',
        }),
        expect.objectContaining({
          type: 'media.uses_routing',
          from: 'media.operation:routed',
          to: 'routing.router:vision-route',
        }),
      ]),
    )
    expect(facts.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          definitionId: 'media.operation:cover',
          ref: expect.objectContaining({ role: 'config', property: 'options' }),
        }),
      ]),
    )
    expect(facts.lintFindings?.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining([
        'media.invalid-provider-file',
        'media.asset-ref-not-hydrated',
      ]),
    )
    expect(JSON.stringify(facts)).not.toMatch(/private-file-id|private-ref/)
  })
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-semantic-media-'))
  roots.push(root)
  const scope = join(root, 'node_modules/@use-crux')
  await mkdir(scope, { recursive: true })
  await Promise.all(
    ['ai', 'core', 'openai'].map((name) =>
      symlink(join(process.cwd(), `../${name}`), join(scope, name), 'dir'),
    ),
  )
  await Promise.all([
    symlink(
      join(process.cwd(), '../ai/node_modules/ai'),
      join(root, 'node_modules/ai'),
      'dir',
    ),
    symlink(
      join(process.cwd(), '../openai/node_modules/openai'),
      join(root, 'node_modules/openai'),
      'dir',
    ),
  ])
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
      include: ['media.ts'],
    }),
  )
  return root
}
