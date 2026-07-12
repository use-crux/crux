import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { semanticIndexFacts } from '../src/indexer/semantic/evidence/facts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('semantic authored-media evidence', () => {
  it('resolves imported aliases, local option bindings, routing, and deterministic misuse evidence', async () => {
    const root = await fixtureRoot()
    const file = join(root, 'media.ts')
    await writeFile(
      file,
      [
        `import { generateImage as image } from '@use-crux/ai'`,
        `import { generate, router } from '@use-crux/core'`,
        `const render = image`,
        `const generateImage = (input: unknown) => input`,
        `export const fake = generateImage({ prompt: 'not crux' })`,
        `const route = router({ id: 'vision-route' })`,
        `const options = { adapter: 'google', model: route, n: 2, size: '1024x1024', messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'provider-file', provider: 'openai', fileId: 'private-file-id' } }] }] }`,
        `export const cover = render(options)`,
        `export const unsafe = generate({ adapter: 'google', messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'asset-ref', ref: { uri: 'private-ref' } } }] }] })`,
        `export const unknown = generate({ messages: dynamicMessages })`,
      ].join('\n'),
    )

    const facts = semanticIndexFacts(root, [file])
    const cover = facts.definitions?.find((definition) => definition.id === 'media.operation:cover')
    const unsafe = facts.definitions?.find((definition) => definition.id === 'media.operation:unsafe')

    expect(cover?.metadata?.facts).toEqual({
      kind: 'media.operation',
      operation: 'generateImage',
      outputModalities: ['image'],
      adapter: 'google',
      execution: 'unknown',
      authoredOptions: { n: 2, size: '1024x1024' },
    })
    expect(unsafe?.metadata?.facts).toMatchObject({
      kind: 'media.operation',
      operation: 'generate',
      inputModalities: ['image'],
    })
    expect(facts.definitions?.some((definition) => definition.id === 'media.operation:unknown')).toBe(false)
    expect(facts.definitions?.some((definition) => definition.id === 'media.operation:fake')).toBe(false)
    expect(facts.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'media.uses_routing', from: 'media.operation:cover', to: 'routing.router:vision-route' }),
      ]),
    )
    expect(facts.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ definitionId: 'media.operation:cover', ref: expect.objectContaining({ role: 'config', property: 'options' }) }),
      ]),
    )
    expect(facts.lintFindings?.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining([
        'media.invalid-provider-file',
        'media.asset-ref-not-hydrated',
        'media.output-discarded',
      ]),
    )
    expect(JSON.stringify(facts)).not.toMatch(/private-file-id|private-ref/)
  })
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-semantic-media-'))
  roots.push(root)
  await mkdir(root, { recursive: true })
  return root
}
