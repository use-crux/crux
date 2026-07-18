import { describe, expect, it } from 'vitest'
import { applyIndexPatch, emptyIndexPatchState, enforceIndexPatchBudget } from '../src/indexer/patches'

describe('index patch merge', () => {
  it('lets fresh AST facts replace cached definition fields', () => {
    const cached = applyIndexPatch(emptyIndexPatchState(), {
      schemaVersion: 1,
      phase: 'cache',
      project: { root: '/repo' },
      startedAt: '2026-06-02T10:00:00.000Z',
      finishedAt: '2026-06-02T10:00:00.001Z',
      status: 'ok',
      facts: {
        definitions: [
          {
            id: 'prompt:writer',
            kind: 'prompt',
            name: 'writer cached',
            fidelity: 'resolved',
            metadata: { stale: true, cacheOnly: true },
          },
        ],
      },
    })

    const refreshed = applyIndexPatch(cached, {
      schemaVersion: 1,
      phase: 'ast',
      project: { root: '/repo' },
      startedAt: '2026-06-02T10:00:01.000Z',
      finishedAt: '2026-06-02T10:00:01.001Z',
      status: 'ok',
      facts: {
        definitions: [
          {
            id: 'prompt:writer',
            kind: 'prompt',
            name: 'writer source',
            fidelity: 'partial',
            source: { file: '/repo/prompts/writer.ts', line: 12 },
            metadata: { stale: false, ast: true },
          },
        ],
      },
    })

    expect(refreshed.definitions).toEqual([
      expect.objectContaining({
        id: 'prompt:writer',
        name: 'writer source',
        fidelity: 'partial',
        source: { file: '/repo/prompts/writer.ts', line: 12 },
        metadata: { stale: false, ast: true },
      }),
    ])
  })

  it('lets full AST patches drop stale cached definitions', () => {
    const cached = applyIndexPatch(emptyIndexPatchState(), {
      schemaVersion: 1,
      phase: 'cache',
      project: { root: '/repo' },
      startedAt: '2026-06-02T10:00:00.000Z',
      finishedAt: '2026-06-02T10:00:00.001Z',
      status: 'ok',
      facts: {
        definitions: [
          {
            id: 'prompt:stale',
            kind: 'prompt',
            name: 'stale',
            fidelity: 'resolved',
          },
        ],
      },
    })

    const refreshed = applyIndexPatch(cached, {
      schemaVersion: 1,
      phase: 'ast',
      project: { root: '/repo' },
      startedAt: '2026-06-02T10:00:01.000Z',
      finishedAt: '2026-06-02T10:00:01.001Z',
      status: 'ok',
      invalidates: { all: true },
      facts: {
        definitions: [
          {
            id: 'prompt:fresh',
            kind: 'prompt',
            name: 'fresh',
            fidelity: 'partial',
          },
        ],
      },
    })

    expect(refreshed.definitions.map((definition) => definition.id)).toEqual(['prompt:fresh'])
  })

  it('applies exact file invalidation before merging replacement facts', () => {
    const initial = applyIndexPatch(emptyIndexPatchState(), {
      schemaVersion: 1,
      phase: 'ast',
      project: { root: '/repo' },
      startedAt: '2026-06-02T10:00:00.000Z',
      finishedAt: '2026-06-02T10:00:00.001Z',
      status: 'ok',
      facts: {
        definitions: [
          {
            id: 'prompt:writer',
            kind: 'prompt',
            name: 'writer',
            fidelity: 'partial',
            source: { file: '/repo/src/writer.ts', line: 2 },
          },
          {
            id: 'prompt:stable',
            kind: 'prompt',
            name: 'stable',
            fidelity: 'partial',
            source: { file: '/repo/src/stable.ts', line: 2 },
          },
        ],
        relations: [
          {
            id: 'relation:prompt:writer:prompt.uses_context:context:brand',
            type: 'prompt.uses_context',
            from: 'prompt:writer',
            to: 'context:brand',
            fidelity: 'partial',
          },
          {
            id: 'relation:prompt:stable:prompt.uses_context:context:brand',
            type: 'prompt.uses_context',
            from: 'prompt:stable',
            to: 'context:brand',
            fidelity: 'partial',
          },
        ],
        diagnostics: [
          {
            id: 'diagnostic:writer',
            severity: 'warning',
            code: 'index.writer',
            message: 'writer warning',
            source: { file: '/repo/src/writer.ts', line: 1 },
          },
          {
            id: 'diagnostic:stable',
            severity: 'warning',
            code: 'index.stable',
            message: 'stable warning',
            source: { file: '/repo/src/stable.ts', line: 1 },
          },
        ],
        lintFindings: [
          {
            id: 'lint:writer',
            ruleId: 'index.prompt.description',
            category: 'quality',
            maturity: 'stable',
            confidence: 'high',
            profiles: ['recommended'],
            severity: 'warning',
            title: 'writer lint',
            message: 'writer lint',
            rationale: 'writer rationale',
            primaryDefinitionId: 'prompt:writer',
            relatedDefinitionIds: [],
            evidence: [],
            fixes: [],
            docsUrl: 'https://example.com/writer',
          },
          {
            id: 'lint:stable',
            ruleId: 'index.prompt.description',
            category: 'quality',
            maturity: 'stable',
            confidence: 'high',
            profiles: ['recommended'],
            severity: 'warning',
            title: 'stable lint',
            message: 'stable lint',
            rationale: 'stable rationale',
            primaryDefinitionId: 'prompt:stable',
            relatedDefinitionIds: [],
            evidence: [],
            fixes: [],
            docsUrl: 'https://example.com/stable',
          },
        ],
        sources: [
          {
            file: '/repo/src/writer.ts',
            status: 'indexed',
            definitionIds: ['prompt:writer'],
            dependencies: [],
            dependents: [],
            diagnostics: ['diagnostic:writer'],
          },
          {
            file: '/repo/src/stable.ts',
            status: 'indexed',
            definitionIds: ['prompt:stable'],
            dependencies: [],
            dependents: [],
            diagnostics: ['diagnostic:stable'],
          },
        ],
      },
    })

    const refreshed = applyIndexPatch(initial, {
      schemaVersion: 1,
      phase: 'ast',
      project: { root: '/repo' },
      startedAt: '2026-06-02T10:00:01.000Z',
      finishedAt: '2026-06-02T10:00:01.001Z',
      status: 'ok',
      invalidates: {
        files: ['/repo/src/writer.ts'],
        definitionIds: ['prompt:writer'],
      },
      facts: {
        definitions: [
          {
            id: 'prompt:writer',
            kind: 'prompt',
            name: 'writer updated',
            fidelity: 'partial',
            source: { file: '/repo/src/writer.ts', line: 4 },
          },
        ],
        diagnostics: [],
        lintFindings: [],
        sources: [
          {
            file: '/repo/src/writer.ts',
            status: 'indexed',
            definitionIds: ['prompt:writer'],
            dependencies: [],
            dependents: [],
            diagnostics: [],
          },
        ],
      },
    })

    expect(refreshed.definitions.map((definition) => definition.id).sort()).toEqual(['prompt:stable', 'prompt:writer'])
    expect(refreshed.definitions.find((definition) => definition.id === 'prompt:writer')).toMatchObject({
      name: 'writer updated',
      source: { file: '/repo/src/writer.ts', line: 4 },
    })
    expect(refreshed.relations).toEqual([expect.objectContaining({ from: 'prompt:stable' })])
    expect(refreshed.diagnostics).toEqual([expect.objectContaining({ id: 'diagnostic:stable' })])
    expect(refreshed.lintFindings).toEqual([expect.objectContaining({ id: 'lint:stable' })])
    expect(refreshed.sources).toEqual([
      expect.objectContaining({ file: '/repo/src/stable.ts' }),
      expect.objectContaining({ file: '/repo/src/writer.ts', diagnostics: [] }),
    ])
  })

  it('replaces outgoing source dependencies and recomputes reverse dependents', () => {
    const initial = applyIndexPatch(emptyIndexPatchState(), {
      schemaVersion: 1,
      phase: 'ast',
      project: { root: '/repo' },
      startedAt: '2026-06-02T10:00:00.000Z',
      finishedAt: '2026-06-02T10:00:00.001Z',
      status: 'ok',
      facts: {
        sources: [
          {
            file: '/repo/src/writer.ts',
            status: 'indexed',
            definitionIds: ['prompt:writer'],
            dependencies: ['/repo/src/brand.ts'],
            dependents: [],
            diagnostics: [],
          },
          {
            file: '/repo/src/brand.ts',
            status: 'indexed',
            definitionIds: ['context:brand'],
            dependencies: [],
            dependents: ['/repo/src/writer.ts'],
            diagnostics: [],
          },
          {
            file: '/repo/src/tone.ts',
            status: 'indexed',
            definitionIds: ['context:tone'],
            dependencies: [],
            dependents: ['/repo/src/other.ts'],
            diagnostics: [],
          },
        ],
      },
    })

    const refreshed = applyIndexPatch(initial, {
      schemaVersion: 1,
      phase: 'ast',
      project: { root: '/repo' },
      startedAt: '2026-06-02T10:00:01.000Z',
      finishedAt: '2026-06-02T10:00:01.001Z',
      status: 'ok',
      invalidates: { files: ['/repo/src/writer.ts'] },
      facts: {
        sources: [
          {
            file: '/repo/src/writer.ts',
            status: 'indexed',
            definitionIds: ['prompt:writer'],
            dependencies: ['/repo/src/tone.ts'],
            dependents: [],
            diagnostics: [],
          },
          {
            file: '/repo/src/tone.ts',
            status: 'indexed',
            definitionIds: ['context:tone'],
            dependencies: [],
            dependents: ['/repo/src/writer.ts'],
            diagnostics: [],
          },
        ],
      },
    })

    expect(sourceByFile(refreshed.sources, '/repo/src/writer.ts')?.dependencies).toEqual(['/repo/src/tone.ts'])
    expect(sourceByFile(refreshed.sources, '/repo/src/brand.ts')?.dependents).toEqual([])
    expect(sourceByFile(refreshed.sources, '/repo/src/tone.ts')?.dependents).toEqual([
      '/repo/src/other.ts',
      '/repo/src/writer.ts',
    ])
  })

  it('removes dangling source graph edges when a file is deleted', () => {
    const initial = applyIndexPatch(emptyIndexPatchState(), {
      schemaVersion: 1,
      phase: 'ast',
      project: { root: '/repo' },
      startedAt: '2026-06-02T10:00:00.000Z',
      finishedAt: '2026-06-02T10:00:00.001Z',
      status: 'ok',
      facts: {
        sources: [
          {
            file: '/repo/src/deleted.ts',
            status: 'indexed',
            definitionIds: ['prompt:deleted'],
            dependencies: ['/repo/src/brand.ts'],
            dependents: ['/repo/src/consumer.ts'],
            diagnostics: [],
          },
          {
            file: '/repo/src/brand.ts',
            status: 'indexed',
            definitionIds: ['context:brand'],
            dependencies: [],
            dependents: ['/repo/src/deleted.ts'],
            diagnostics: [],
          },
          {
            file: '/repo/src/consumer.ts',
            status: 'indexed',
            definitionIds: ['agent:consumer'],
            dependencies: ['/repo/src/deleted.ts'],
            dependents: [],
            diagnostics: [],
          },
        ],
      },
    })

    const deleted = applyIndexPatch(initial, {
      schemaVersion: 1,
      phase: 'ast',
      project: { root: '/repo' },
      startedAt: '2026-06-02T10:00:01.000Z',
      finishedAt: '2026-06-02T10:00:01.001Z',
      status: 'ok',
      invalidates: { files: ['/repo/src/deleted.ts'] },
      facts: { sources: [] },
    })

    expect(sourceByFile(deleted.sources, '/repo/src/deleted.ts')).toBeUndefined()
    expect(sourceByFile(deleted.sources, '/repo/src/brand.ts')?.dependents).toEqual([])
    expect(sourceByFile(deleted.sources, '/repo/src/consumer.ts')?.dependencies).toEqual([])
  })

  it('lets semantic facts enrich stable definitions without owning core fields', () => {
    const ast = applyIndexPatch(emptyIndexPatchState(), {
      schemaVersion: 1,
      phase: 'ast',
      project: { root: '/repo' },
      startedAt: '2026-06-02T10:00:00.000Z',
      finishedAt: '2026-06-02T10:00:00.001Z',
      status: 'ok',
      facts: {
        definitions: [
          {
            id: 'prompt:writer',
            kind: 'prompt',
            name: 'writer source',
            fidelity: 'partial',
            source: { file: '/repo/prompts/writer.ts', line: 12 },
            metadata: { ast: true, inputSchema: { type: 'object' } },
            sourceRefs: [
              {
                id: 'prompt:writer:source:system:WRITER_SYSTEM',
                role: 'system',
                symbol: 'WRITER_SYSTEM',
                source: { file: '/repo/prompts/writer.ts', line: 4 },
                fidelity: 'partial',
              },
            ],
          },
        ],
      },
    })

    const enriched = applyIndexPatch(ast, {
      schemaVersion: 1,
      phase: 'semantic',
      project: { root: '/repo' },
      startedAt: '2026-06-02T10:00:01.000Z',
      finishedAt: '2026-06-02T10:00:01.001Z',
      status: 'ok',
      facts: {
        definitions: [
          {
            id: 'prompt:writer',
            kind: 'prompt',
            name: 'writer semantic',
            fidelity: 'resolved',
            metadata: { semantic: true, inputSchema: { type: 'object', additionalProperties: false } },
            sourceRefs: [
              {
                id: 'prompt:writer:source:schema:input:WriterInput',
                role: 'schema',
                property: 'input',
                symbol: 'WriterInput',
                source: { file: '/repo/prompts/schema.ts', line: 3 },
                fidelity: 'resolved',
              },
            ],
          },
        ],
      },
    })

    expect(enriched.definitions).toEqual([
      expect.objectContaining({
        id: 'prompt:writer',
        name: 'writer source',
        fidelity: 'partial',
        source: { file: '/repo/prompts/writer.ts', line: 12 },
        metadata: { ast: true, semantic: true, inputSchema: { type: 'object', additionalProperties: false } },
        sourceRefs: [
          expect.objectContaining({ id: 'prompt:writer:source:system:WRITER_SYSTEM' }),
          expect.objectContaining({ id: 'prompt:writer:source:schema:input:WriterInput' }),
        ],
      }),
    ])
  })

  it('upgrades partial relation facts by logical edge instead of keeping duplicate ids', () => {
    const ast = applyIndexPatch(emptyIndexPatchState(), {
      schemaVersion: 1,
      phase: 'ast',
      project: { root: '/repo' },
      startedAt: '2026-06-02T10:00:00.000Z',
      finishedAt: '2026-06-02T10:00:00.001Z',
      status: 'ok',
      facts: {
        relations: [
          {
            id: 'relation:agent:SupportAgent:agent.uses_tool:tool:searchDocs',
            type: 'agent.uses_tool',
            from: 'agent:SupportAgent',
            to: 'tool:searchDocs',
            fidelity: 'partial',
          },
        ],
      },
    })

    const enriched = applyIndexPatch(ast, {
      schemaVersion: 1,
      phase: 'semantic',
      project: { root: '/repo' },
      startedAt: '2026-06-02T10:00:01.000Z',
      finishedAt: '2026-06-02T10:00:01.001Z',
      status: 'ok',
      facts: {
        relations: [
          {
            id: 'relation:agent.uses_tool:agent:SupportAgent:tool:searchDocs',
            type: 'agent.uses_tool',
            from: 'agent:SupportAgent',
            to: 'tool:searchDocs',
            fidelity: 'resolved',
          },
        ],
      },
    })

    expect(enriched.relations).toEqual([
      expect.objectContaining({
        id: 'relation:agent.uses_tool:agent:SupportAgent:tool:searchDocs',
        type: 'agent.uses_tool',
        from: 'agent:SupportAgent',
        to: 'tool:searchDocs',
        fidelity: 'resolved',
      }),
    ])
  })

  it('replaces diagnostics only for the phase that emitted them', () => {
    const astAndSemantic = applyIndexPatch(
      applyIndexPatch(emptyIndexPatchState(), {
        schemaVersion: 1,
        phase: 'ast',
        project: { root: '/repo' },
        startedAt: '2026-06-02T10:00:00.000Z',
        finishedAt: '2026-06-02T10:00:00.001Z',
        status: 'partial',
        facts: {
          diagnostics: [
            {
              id: 'diagnostic:ast:old',
              severity: 'warning',
              code: 'index.ast.old',
              message: 'old AST diagnostic',
            },
          ],
        },
      }),
      {
        schemaVersion: 1,
        phase: 'semantic',
        project: { root: '/repo' },
        startedAt: '2026-06-02T10:00:01.000Z',
        finishedAt: '2026-06-02T10:00:01.001Z',
        status: 'degraded',
        facts: {
          diagnostics: [
            {
              id: 'diagnostic:semantic:timeout',
              severity: 'info',
              code: 'index.semantic.timeout',
              message: 'semantic enrichment timed out',
            },
          ],
        },
      },
    )

    const refreshedAst = applyIndexPatch(astAndSemantic, {
      schemaVersion: 1,
      phase: 'ast',
      project: { root: '/repo' },
      startedAt: '2026-06-02T10:00:02.000Z',
      finishedAt: '2026-06-02T10:00:02.001Z',
      status: 'ok',
      facts: {
        diagnostics: [],
      },
    })

    expect(refreshedAst.diagnostics).toEqual([
      expect.objectContaining({
        id: 'diagnostic:semantic:timeout',
        code: 'index.semantic.timeout',
      }),
    ])
  })

  it('carries prompt context and tool index arrays for compatibility readers', () => {
    const state = applyIndexPatch(emptyIndexPatchState(), {
      schemaVersion: 1,
      phase: 'ast',
      project: { root: '/repo' },
      startedAt: '2026-06-02T10:00:00.000Z',
      finishedAt: '2026-06-02T10:00:00.001Z',
      status: 'ok',
      facts: {
        prompts: [
          {
            id: 'writer',
            tags: [],
            contextIds: [],
            hasOutput: false,
            settings: {},
          },
        ],
        contexts: [
          {
            id: 'brand',
            priority: 0,
            isStatic: true,
            usedBy: [],
          },
        ],
        tools: [
          {
            name: 'search',
            description: 'Search docs',
          },
        ],
      },
    })

    expect(state.prompts).toHaveLength(1)
    expect(state.contexts).toHaveLength(1)
    expect(state.tools).toHaveLength(1)
  })

  it('degrades a semantic patch that exceeds its fact budget', () => {
    const patch = enforceIndexPatchBudget(
      {
        schemaVersion: 1,
        phase: 'semantic',
        project: { root: '/repo' },
        startedAt: '2026-06-02T10:00:00.000Z',
        finishedAt: '2026-06-02T10:00:00.001Z',
        status: 'ok',
        facts: {
          sourceRefs: [
            {
              definitionId: 'prompt:writer',
              ref: {
                id: 'prompt:writer:source:schema:input:WriterInput',
                role: 'schema',
                property: 'input',
                symbol: 'WriterInput',
                source: { file: '/repo/schema.ts', line: 1 },
                fidelity: 'resolved',
              },
            },
            {
              definitionId: 'prompt:writer',
              ref: {
                id: 'prompt:writer:source:schema:output:WriterOutput',
                role: 'schema',
                property: 'output',
                symbol: 'WriterOutput',
                source: { file: '/repo/schema.ts', line: 8 },
                fidelity: 'resolved',
              },
            },
          ],
        },
      },
      { maxSourceRefs: 1 },
    )

    expect(patch.status).toBe('degraded')
    expect(patch.facts.sourceRefs).toBeUndefined()
    expect(patch.facts.diagnostics).toEqual([
      expect.objectContaining({
        code: 'index.semantic_budget_exceeded',
        severity: 'info',
      }),
    ])
  })
})

function sourceByFile(sources: ReturnType<typeof applyIndexPatch>['sources'], file: string) {
  return sources.find((source) => source.file === file)
}
