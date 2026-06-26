import type { ProjectDefinitionKind } from '@use-crux/core/project-index'
import { describe, expect, it } from 'vitest'
import { createIndexerExtensionRuntime, facts, type IndexerExtension } from '../indexer/extensions'
import { createStaticRecordEvidenceReader } from '../indexer/static-index/extension-host/evidence/record-reader'
import { createTypeScriptStaticSyntaxFrontend } from '../indexer/static-index/syntax'

describe('indexer extension evidence contract', () => {
  it('publishes deterministic static interests from explicit manifests and extractor patterns', () => {
    const runtime = createIndexerExtensionRuntime({
      extensions: [
        extension({
          name: '@acme/policies',
          version: '1',
          static: {
            evidence: { mode: 'declared' },
            interests: {
              definitions: ['agent'],
              relations: ['agent.uses_tool'],
              calls: [
                {
                  name: 'definePolicy',
                  importFrom: ['@acme/policy'],
                  configArg: 0,
                  properties: ['id', 'target'],
                  callbacks: [{ property: 'check', maxDepth: 2 }],
                },
              ],
            },
          },
          extractors: [
            {
              name: 'workflow.define',
              patterns: [{ kind: 'call', name: 'defineWorkflow', importFrom: ['@acme/workflows'], configArg: 1 }],
              extract: (ctx) =>
                facts({
                  definitions: [
                    ctx.define.definition({
                      variableName: ctx.source.variableName,
                      id: `workflow:${ctx.source.localName}`,
                      kind: 'workflow' as ProjectDefinitionKind,
                      name: ctx.source.variableName,
                    }),
                  ],
                }),
            },
            {
              name: 'agent.compat',
              patterns: [{ kind: 'new', name: 'Agent' }],
              extract: () => ({ kind: 'none' }),
            },
          ],
        }),
      ],
    })

    expect(runtime.manifest.staticInterests).toEqual({
      calls: [
        {
          name: 'definePolicy',
          importFrom: ['@acme/policy'],
          configArg: 0,
          properties: ['id', 'target'],
          callbacks: [{ property: 'check', maxDepth: 2 }],
          source: 'manifest',
        },
        {
          name: 'defineWorkflow',
          importFrom: ['@acme/workflows'],
          configArg: 1,
          source: 'extractor-pattern',
        },
      ],
      constructors: [{ name: 'Agent', source: 'extractor-pattern' }],
      definitions: ['agent'],
      relations: ['agent.uses_tool'],
      compatibility: { mode: 'declared' },
    })
    expect(runtime.manifest.staticHost).toEqual(
      expect.objectContaining({
        bundledNativeExtractorCount: 0,
        bundledTypeScriptExtractorCount: 0,
        extensionTypeScriptExtractorCount: 2,
        typeScriptRuleCount: 0,
        requiresTypeScriptHostForBundled: false,
        requiresTypeScriptHostForExtensions: true,
        requiresTypeScriptHostForRules: false,
        requiresCompatibilityEvidence: false,
        nativeOnlyEligible: false,
      }),
    )
    expect(runtime.manifest.staticHost.extractors.map((item) => item.mode)).toEqual([
      'typescript-extension',
      'typescript-extension',
    ])
  })

  it('separates native-covered bundled extractors from TypeScript host work', () => {
    const runtime = createIndexerExtensionRuntime({
      extensions: [
        extension({
          name: '@use-crux/indexer/crux-core',
          version: '1',
          static: { evidence: { mode: 'declared' } },
          extractors: [
            {
              name: 'routing',
              patterns: [{ kind: 'call', name: 'router' }],
              extract: () => ({ kind: 'none' }),
            },
            {
              name: 'prompt',
              patterns: [{ kind: 'call', name: 'prompt' }],
              extract: () => ({ kind: 'none' }),
            },
          ],
        }),
      ],
    })

    expect(runtime.manifest.staticHost.extractors.map(({ name, mode }) => `${name}:${mode}`)).toEqual([
      'prompt:native-covered',
      'routing:native-covered',
    ])
    expect(runtime.manifest.staticHost).toEqual(
      expect.objectContaining({
        bundledNativeExtractorCount: 2,
        bundledTypeScriptExtractorCount: 0,
        extensionTypeScriptExtractorCount: 0,
        requiresTypeScriptHostForBundled: false,
        nativeOnlyEligible: true,
      }),
    )
  })

  it('marks extractor extensions without declared evidence as compatibility fallback', () => {
    const runtime = createIndexerExtensionRuntime({
      extensions: [
        extension({
          name: '@acme/legacy',
          version: '1',
          extractors: [
            {
              name: 'legacy',
              patterns: [{ kind: 'call', name: 'legacyPrimitive' }],
              extract: () => ({ kind: 'none' }),
            },
          ],
        }),
      ],
    })

    expect(runtime.manifest.staticInterests.compatibility).toEqual({
      mode: 'compatibility',
      reason: '@acme/legacy has not declared bounded static evidence.',
    })
    expect(runtime.manifest.staticHost).toEqual(
      expect.objectContaining({
        requiresCompatibilityEvidence: true,
        compatibilityReason: '@acme/legacy has not declared bounded static evidence.',
        nativeOnlyEligible: false,
      }),
    )
  })

  it('queries static syntax records as bounded evidence for TS extensions', async () => {
    const frontend = createTypeScriptStaticSyntaxFrontend({ callNames: ['definePolicy'] })
    const record = await frontend.parseFile({
      root: '/repo',
      file: '/repo/src/policy.ts',
      source: [
        "import { definePolicy } from '@acme/policy'",
        "const auditCheck = () => workspace.writeFile('audit.log', 'tenant')",
        'export const policy = definePolicy({',
        "  id: 'tenant-policy',",
        '  target: agentOne,',
        '  check: auditCheck,',
        '})',
      ].join('\n'),
    })

    const evidence = createStaticRecordEvidenceReader({ root: '/repo', record })
    const calls = evidence.calls({ name: 'definePolicy', importFrom: ['@acme/policy'] })

    expect(calls).toHaveLength(1)
    expect(JSON.parse(JSON.stringify(calls))).toEqual(calls)
    expect(calls[0]).toEqual(
      expect.objectContaining({
        kind: 'call',
        variableName: 'policy',
        exported: true,
        callee: expect.objectContaining({
          name: 'definePolicy',
          moduleSpecifier: '@acme/policy',
        }),
      }),
    )
    const config = evidence.config(calls[0]!.id)
    expect(config?.string('id')).toBe('tenant-policy')
    expect(config?.reference('target')).toBe('agentOne')

    const callback = evidence.callbackSummary({
      evidenceId: calls[0]!.id,
      property: 'check',
      maxDepth: 1,
    })

    expect(callback).toEqual(
      expect.objectContaining({
        property: 'check',
        calls: [
          expect.objectContaining({
            callee: expect.objectContaining({ name: 'writeFile' }),
            receiver: expect.objectContaining({ kind: 'identifier', name: 'workspace' }),
          }),
        ],
      }),
    )
  })
})

function extension(input: IndexerExtension): IndexerExtension {
  return input
}
