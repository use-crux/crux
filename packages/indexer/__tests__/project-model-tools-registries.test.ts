import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveProjectModel } from '../index'

const roots: string[] = []
const testWorkspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(testWorkspaceRoot, '.tmp-project-model-tools-registries-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Project Model tools and registries', () => {
  it('exposes no-config exported tools with source provenance', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@fixture/source-tools' }))
    await writeFile(
      join(root, 'src/tools.ts'),
      `
        import { tool } from '@crux/core/tools'
        import { z } from 'zod'

        export const searchDocs = tool({
          name: 'searchDocs',
          description: 'Search documentation',
          input: z.object({ query: z.string() }),
          execute: async () => [],
        })
      `,
    )

    const model = await resolveProjectModel({ root, resolutionMode: 'source-only' })
    const byId: ReadonlyMap<string, (typeof model.definitions)[number]> = new Map(
      model.definitions.map((definition) => [definition.id, definition]),
    )

    expect(byId.get('tool:searchDocs')).toMatchObject({
      kind: 'tool',
      name: {
        value: 'searchDocs',
        provenance: { kind: 'source', file: join(root, 'src/tools.ts'), exportName: 'searchDocs' },
      },
      visibility: {
        value: 'inferred',
        provenance: { kind: 'source', file: join(root, 'src/tools.ts'), exportName: 'searchDocs' },
      },
    })
  })

  it('exposes no-config exported registries with source provenance', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@fixture/source-registries' }))
    await writeFile(
      join(root, 'src/skills.ts'),
      `
        import { registry } from '@crux/core/skill'

        export const acme = registry({
          name: 'acme',
          baseUrl: 'https://skills.acme.test',
        })
      `,
    )

    const model = await resolveProjectModel({ root, resolutionMode: 'source-only' })
    const byId: ReadonlyMap<string, (typeof model.definitions)[number]> = new Map(
      model.definitions.map((definition) => [definition.id, definition]),
    )

    expect(model.configFiles).toContainEqual(
      expect.objectContaining({ status: expect.objectContaining({ value: 'missing' }) }),
    )
    expect(byId.get('registry:acme')).toMatchObject({
      kind: 'registry',
      name: {
        value: 'acme',
        provenance: { kind: 'source', file: join(root, 'src/skills.ts'), exportName: 'acme' },
      },
      visibility: {
        value: 'inferred',
        provenance: { kind: 'source', file: join(root, 'src/skills.ts'), exportName: 'acme' },
      },
      metadata: expect.objectContaining({
        baseUrl: 'https://skills.acme.test',
        hasAuth: false,
      }),
    })
  })

  it('exposes custom registry-backed skills as source relations to registry values', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@fixture/source-registry-skills' }))
    await writeFile(
      join(root, 'src/skills.ts'),
      `
        import { registry, skill } from '@crux/core/skill'

        export const acme = registry({
          name: 'acme',
          baseUrl: 'https://skills.acme.test',
        })

        export const brand = skill.fromRegistry(acme, 'brand-guidelines')
      `,
    )

    const model = await resolveProjectModel({ root, resolutionMode: 'source-only' })
    const byId: ReadonlyMap<string, (typeof model.definitions)[number]> = new Map(
      model.definitions.map((definition) => [definition.id, definition]),
    )

    expect(byId.get('skill:acme:brand-guidelines')).toMatchObject({
      kind: 'skill',
      name: {
        value: 'acme:brand-guidelines',
        provenance: { kind: 'source', file: join(root, 'src/skills.ts'), exportName: 'brand' },
      },
      visibility: {
        value: 'inferred',
        provenance: { kind: 'source', file: join(root, 'src/skills.ts'), exportName: 'brand' },
      },
      metadata: expect.objectContaining({
        loader: 'registry',
        registryName: 'acme',
        registryPath: 'brand-guidelines',
        registryVariable: 'acme',
      }),
    })
    expect(model.relations).toContainEqual(
      expect.objectContaining({
        type: 'skill.uses_registry',
        from: 'skill:acme:brand-guidelines',
        to: 'registry:acme',
        visibility: {
          value: 'inferred',
          provenance: { kind: 'source', file: join(root, 'src/skills.ts'), exportName: 'brand' },
        },
      }),
    )
  })

  it('exposes bundled registry-backed skills through exported registry values', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@fixture/source-bundled-skills' }))
    await writeFile(
      join(root, 'src/skills.ts'),
      `
        import { skill, skillsSh } from '@crux/core/skill'

        export const seo = skill.fromRegistry(skillsSh, 'owner/repo/seo')
      `,
    )

    const model = await resolveProjectModel({ root, resolutionMode: 'source-only' })
    const byId: ReadonlyMap<string, (typeof model.definitions)[number]> = new Map(
      model.definitions.map((definition) => [definition.id, definition]),
    )

    expect(byId.get('registry:skills.sh')).toMatchObject({
      kind: 'registry',
      name: { value: 'skills.sh' },
      metadata: expect.objectContaining({
        bundled: true,
      }),
    })
    expect(byId.get('skill:skills.sh:owner-repo-seo')).toMatchObject({
      kind: 'skill',
      name: {
        value: 'skills.sh:owner/repo/seo',
        provenance: { kind: 'source', file: join(root, 'src/skills.ts'), exportName: 'seo' },
      },
      metadata: expect.objectContaining({
        loader: 'registry',
        registryName: 'skills.sh',
        registryPath: 'owner/repo/seo',
        registryVariable: 'skillsSh',
      }),
    })
    expect(model.relations).toContainEqual(
      expect.objectContaining({
        type: 'skill.uses_registry',
        from: 'skill:skills.sh:owner-repo-seo',
        to: 'registry:skills.sh',
      }),
    )
  })
})
