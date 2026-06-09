import ts from 'typescript'
import type { ProjectDefinitionKind } from '@crux/core/project-index'
import { describe, expect, it } from 'vitest'
import { facts, type IndexerExtension } from '../indexer/extensions'
import { createStaticExtraction } from '../indexer/static/extraction/engine'
import {
  assertDeterministicExtraction,
  defineIndexerExtensionFixture,
  extractFixtureSource,
} from '../testing'

describe('static extraction engine', () => {
  it('projects stable compiler and syntax frontend identity', () => {
    const extraction = createStaticExtraction({ root: '/fixture', cache: 'none' })

    expect(extraction.identity.cacheInputs).toEqual(
      expect.arrayContaining([
        { kind: 'compiler-profile', name: '@crux/indexer/crux-core-profile', version: '1' },
        { kind: 'syntax-frontend', name: 'typescript', version: ts.version },
      ]),
    )
    expect([...extraction.identity.callNames]).toEqual(expect.arrayContaining([...extraction.manifest.callNames]))
  })

  it('runs extension fixtures through the production extraction path', async () => {
    const fixture = defineIndexerExtensionFixture(workflowExtension())

    const out = await extractFixtureSource(
      fixture,
      `export const workflow = defineWorkflow({ id: 'release' })`,
    )

    expect(out.definitions).toEqual([
      expect.objectContaining({
        id: '@acme.workflow:release',
        kind: 'workflow',
        name: 'release',
      }),
    ])
    expect(out.facts.definitions).toBe(out.definitions)
    expect(out.trace.cacheInputs).toEqual(
      expect.arrayContaining([
        { kind: 'extension', name: '@acme/workflows', version: '1' },
        { kind: 'syntax-frontend', name: 'typescript', version: ts.version },
      ]),
    )
    await expect(assertDeterministicExtraction(fixture, `export const workflow = defineWorkflow({ id: 'release' })`))
      .resolves.toBeUndefined()
  })
})

function workflowExtension(): IndexerExtension {
  return {
    name: '@acme/workflows',
    version: '1',
    extractors: [
      {
        name: 'workflow.define',
        patterns: [{ kind: 'call', name: 'defineWorkflow' }],
        extract: (ctx) => {
          const id = ctx.config?.string('id') ?? ctx.source.localName
          return facts({
            definitions: [
              ctx.define.definition({
                variableName: ctx.source.variableName,
                id: `@acme.workflow:${id}`,
                kind: 'workflow' as ProjectDefinitionKind,
                name: id,
                metadata: { exportName: ctx.source.variableName },
              }),
            ],
          })
        },
      },
    ],
  }
}
