import { describe, expect, it } from 'vitest'
import {
  canonicalIndexPatchFactsJson,
  parityFieldCoverage,
} from '../contracts/parity'
import type { IndexPatchFacts } from '../indexer/patches'

describe('Project Index parity normalizer', () => {
  it('normalizes complete IndexPatchFacts for fail-closed parity checks', () => {
    const first = {
      definitions: [
        {
          id: 'prompt:writer',
          kind: 'prompt',
          name: 'writer',
          fidelity: 'partial',
          sourceRefs: [
            {
              id: 'prompt:writer:system',
              role: 'system',
              source: { file: String.raw`src\writer.ts`, line: 2 },
              fidelity: 'partial',
            },
          ],
          metadata: { facts: { kind: 'prompt', schema: { type: 'object' } } },
        },
        { id: 'context:brand', kind: 'context', name: 'context', fidelity: 'partial' },
      ],
      relations: [
        {
          id: 'relation:writer-brand',
          type: 'prompt.uses_context',
          from: 'prompt:writer',
          to: 'context:brand',
          fidelity: 'partial',
        },
      ],
      sourceRefs: [
        {
          definitionId: 'prompt:writer',
          ref: {
            id: 'prompt:writer:system',
            role: 'system',
            source: { file: String.raw`src\writer.ts`, line: 2 },
            fidelity: 'partial',
          },
        },
      ],
      diagnostics: [
        {
          id: 'diagnostic:writer',
          severity: 'warning',
          code: 'index.writer',
          message: 'writer warning',
          source: { file: String.raw`src\writer.ts`, line: 2 },
        },
      ],
      lintFindings: [
        {
          id: 'lint:writer',
          severity: 'warning',
          ruleId: 'quality.prompt_baseline',
          category: 'quality',
          maturity: 'stable',
          confidence: 'high',
          profiles: ['strict', 'recommended'],
          title: 'Missing baseline',
          message: 'Add a baseline.',
          rationale: 'Baselines make regressions visible.',
          relatedDefinitionIds: [],
          evidence: [],
          fixes: [],
          docsUrl: 'https://example.com/docs',
        },
      ],
      ruleDescriptors: [
        {
          id: 'quality.prompt_baseline',
          source: 'builtin',
          title: 'Prompt baseline',
          description: 'Requires prompt baselines.',
          profiles: ['recommended', 'strict'],
          requires: ['definitions'],
          messageIds: ['missing'],
        },
      ],
      sources: [
        {
          file: String.raw`src\writer.ts`,
          status: 'indexed',
          definitionIds: ['prompt:writer'],
          dependencies: [String.raw`src\brand.ts`],
        },
      ],
      sourceGraph: {
        schemaVersion: 1,
        producedBy: '@use-crux/indexer',
        capabilities: ['source-dependencies', 'project-shards'],
        shards: [
          {
            id: 'root',
            root: String.raw`packages\app`,
            references: [String.raw`packages\core`],
          },
        ],
      },
    } satisfies IndexPatchFacts
    const second = {
      sourceGraph: {
        producedBy: '@use-crux/indexer',
        schemaVersion: 1,
        shards: [{ references: ['packages/core'], root: 'packages/app', id: 'root' }],
        capabilities: ['project-shards', 'source-dependencies'],
      },
      sources: [{ dependencies: ['src/brand.ts'], definitionIds: ['prompt:writer'], status: 'indexed', file: 'src/writer.ts' }],
      ruleDescriptors: [
        {
          messageIds: ['missing'],
          requires: ['definitions'],
          profiles: ['strict', 'recommended'],
          description: 'Requires prompt baselines.',
          title: 'Prompt baseline',
          source: 'builtin',
          id: 'quality.prompt_baseline',
        },
      ],
      lintFindings: [
        {
          docsUrl: 'https://example.com/docs',
          fixes: [],
          evidence: [],
          relatedDefinitionIds: [],
          rationale: 'Baselines make regressions visible.',
          message: 'Add a baseline.',
          title: 'Missing baseline',
          profiles: ['recommended', 'strict'],
          confidence: 'high',
          maturity: 'stable',
          category: 'quality',
          ruleId: 'quality.prompt_baseline',
          severity: 'warning',
          id: 'lint:writer',
        },
      ],
      diagnostics: [
        {
          source: { file: 'src/writer.ts', line: 2 },
          message: 'writer warning',
          code: 'index.writer',
          severity: 'warning',
          id: 'diagnostic:writer',
        },
      ],
      sourceRefs: [
        {
          ref: {
            fidelity: 'partial',
            source: { line: 2, file: 'src/writer.ts' },
            role: 'system',
            id: 'prompt:writer:system',
          },
          definitionId: 'prompt:writer',
        },
      ],
      relations: [
        {
          fidelity: 'partial',
          to: 'context:brand',
          from: 'prompt:writer',
          type: 'prompt.uses_context',
          id: 'relation:writer-brand',
        },
      ],
      definitions: [
        { fidelity: 'partial', name: 'context', kind: 'context', id: 'context:brand' },
        {
          metadata: { facts: { schema: { type: 'object' }, kind: 'prompt' } },
          sourceRefs: [
            {
              fidelity: 'partial',
              source: { line: 2, file: 'src/writer.ts' },
              role: 'system',
              id: 'prompt:writer:system',
            },
          ],
          fidelity: 'partial',
          name: 'writer',
          kind: 'prompt',
          id: 'prompt:writer',
        },
      ],
    } satisfies IndexPatchFacts

    expect(canonicalIndexPatchFactsJson(first)).toBe(canonicalIndexPatchFactsJson(second))
    expect(canonicalIndexPatchFactsJson({ ...first, definitions: [{ ...first.definitions[0], name: 'changed' }] }))
      .not.toBe(canonicalIndexPatchFactsJson(second))
    expect(() =>
      canonicalIndexPatchFactsJson({
        definitions: [{ ...first.definitions[0], unsupportedParityField: true }],
      } as unknown as IndexPatchFacts),
    ).toThrow(/unknown parity field/i)
    expect(parityFieldCoverage.indexPatchFacts).toEqual([
      'prompts',
      'contexts',
      'tools',
      'lint',
      'definitions',
      'relations',
      'sourceRefs',
      'diagnostics',
      'lintFindings',
      'ruleDescriptors',
      'sources',
      'sourceGraph',
    ])
  })
})

