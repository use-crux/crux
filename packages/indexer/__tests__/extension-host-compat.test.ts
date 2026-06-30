import type { IndexLintFinding, ProjectDefinitionKind } from '@use-crux/core/project-index'
import { describe, expect, it } from 'vitest'
import { cruxCoreExtension } from '../indexer/extractors/crux-core-extension'
import { facts, type IndexerExtension } from '../indexer/extensions'
import {
  checkStaticRules,
  extractStaticEvidenceBatch,
  loadStaticExtensionHostManifest,
} from '../indexer/static-index/extension-host/evidence/host'
import { indexLintFinding } from '../indexer/lints/rules'
import { createTypeScriptStaticSyntaxFrontend } from '../indexer/static-index/syntax'
import { checkStaticRulesForProject, loadStaticExtensionHostManifestForProject } from '../host/static-compat'

describe('static extension host compatibility layer', () => {
  it('loads a data-only host manifest with machine-readable Node reasons', async () => {
    const result = await loadStaticExtensionHostManifest({
      root: '/project',
      extensions: [
        extension({
          name: '@acme/workflows',
          version: '1',
          crux: { indexer: '^0.1.0', projectIndexSchema: 1 },
          static: {
            evidence: { mode: 'declared' },
            interests: {
              calls: [
                {
                  name: 'defineWorkflow',
                  importFrom: ['@acme/workflows'],
                  configArg: 0,
                  properties: ['id', 'target'],
                },
              ],
            },
          },
          extractors: [
            {
              name: 'workflow.define',
              patterns: [{ kind: 'call', name: 'defineWorkflow', importFrom: ['@acme/workflows'] }],
              extract: (ctx) =>
                facts({
                  definitions: [
                    ctx.define.definition({
                      variableName: ctx.source.variableName,
                      id: `@acme/workflow:${ctx.source.localName}`,
                      kind: '@acme/workflow' as ProjectDefinitionKind,
                      name: ctx.config?.string('id') ?? ctx.source.localName,
                    }),
                  ],
                }),
            },
          ],
        }),
      ],
      nativeCompilerProtocolVersion: 1,
    })

    expect(result.method).toBe('loadStaticExtensionHostManifest')
    expect(result.diagnostics).toEqual([])
    expect(result.nativeOnlyEligible).toBe(false)
    expect(result.node).toEqual({
      started: true,
      reasons: ['typescript-extension-extractors'],
    })
    expect(result.manifest).toEqual(
      expect.objectContaining({
        extensions: [{ name: '@acme/workflows', version: '1' }],
        relationSpecs: [],
        staticHost: expect.objectContaining({
          extensionTypeScriptExtractorCount: 1,
          requiresCompatibilityEvidence: false,
        }),
      }),
    )
  })

  it('reports no Node work for native-covered first-party extractors', async () => {
    const result = await loadStaticExtensionHostManifest({
      root: '/project',
      extensions: [cruxCoreExtension],
      nativeCompilerProtocolVersion: 1,
    })

    expect(result.node).toEqual({ started: false, reasons: [] })
    expect(result.nativeOnlyEligible).toBe(true)
    expect(result.manifest.staticHost).toEqual(
      expect.objectContaining({
        bundledNativeExtractorCount: 18,
        bundledTypeScriptExtractorCount: 0,
        extensionTypeScriptExtractorCount: 0,
        requiresCompatibilityEvidence: false,
      }),
    )
  })

  it('loads the project-scoped host manifest with config diagnostics', async () => {
    const result = await loadStaticExtensionHostManifestForProject({
      root: '/project',
      nativeCompilerProtocolVersion: 1,
    })

    expect(result.method).toBe('loadStaticExtensionHostManifest')
    expect(result.nativeCompilerProtocolVersion).toBe(1)
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'index.config_not_found' })])
    expect(result.ruleDescriptors).toEqual([])
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })

  it('extracts a declared evidence batch through data-only syntax evidence', async () => {
    const workflowExtension = extension({
      name: '@acme/workflows',
      version: '1',
      crux: { indexer: '^0.1.0', projectIndexSchema: 1 },
      static: { evidence: { mode: 'declared' } },
      extractors: [
        {
          name: 'workflow.define',
          patterns: [{ kind: 'call', name: 'defineWorkflow', importFrom: ['@acme/workflows'] }],
          extract: (ctx) =>
            facts({
              definitions: [
                ctx.define.definition({
                  variableName: ctx.source.variableName,
                  id: `@acme/workflow:${ctx.config?.string('id') ?? ctx.source.localName}`,
                  kind: '@acme/workflow' as ProjectDefinitionKind,
                  name: ctx.config?.string('id') ?? ctx.source.localName,
                }),
              ],
              references: [ctx.ref.variable('@acme/workflow/uses_tool', ctx.config?.reference('target') ?? 'missing')],
            }),
        },
      ],
    })
    const frontend = createTypeScriptStaticSyntaxFrontend({ callNames: ['defineWorkflow'] })
    const record = await frontend.parseFile({
      root: '/project',
      file: '/project/src/workflow.ts',
      source: [
        "import { defineWorkflow } from '@acme/workflows'",
        "export const workflow = defineWorkflow({ id: 'publish', target: writerTool })",
      ].join('\n'),
    })
    const match = record.matches.find((item) => item.variableName === 'workflow')

    expect(match).toBeDefined()
    const result = await extractStaticEvidenceBatch({
      root: '/project',
      extensions: [workflowExtension],
      jobs: [
        {
          id: 'job-1',
          extractor: { extension: { name: '@acme/workflows', version: '1' }, name: 'workflow.define' },
          file: record.file,
          sourceHash: record.sourceHash,
          evidence: match!,
          imports: record.imports,
          localInitializers: record.localInitializers,
        },
      ],
    })

    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    expect(result.method).toBe('extractStaticEvidenceBatch')
    expect(result.facts).toEqual({
      definitions: [
        expect.objectContaining({
          id: '@acme/workflow:publish',
          kind: '@acme/workflow',
          name: 'publish',
        }),
      ],
      relationRefs: [
        {
          ownerDefinitionId: '@acme/workflow:publish',
          type: '@acme/workflow/uses_tool',
          toVariable: 'writerTool',
        },
      ],
    })
    expect(result.results).toEqual([
      {
        jobId: 'job-1',
        result: expect.objectContaining({
          kind: 'matched',
          extension: { name: '@acme/workflows', version: '1' },
          extractor: 'workflow.define',
          facts: expect.objectContaining({
            definitions: [
              expect.objectContaining({
                variableName: 'workflow',
                definition: expect.objectContaining({
                  id: '@acme/workflow:publish',
                  kind: '@acme/workflow',
                  name: 'publish',
                }),
              }),
            ],
            references: [{ type: '@acme/workflow/uses_tool', toVariable: 'writerTool' }],
          }),
        }),
      },
    ])
  })

  it('checks TypeScript rules over finalized graph facts', async () => {
    const workflow = {
      id: '@acme/workflow:publish',
      kind: '@acme/workflow' as ProjectDefinitionKind,
      name: 'publish',
      fidelity: 'resolved' as const,
      source: { file: '/project/src/workflow.ts', line: 2 },
    }
    const result = await checkStaticRules({
      root: '/project',
      extensions: [
        extension({
          name: '@acme/rules',
          version: '1',
          crux: { indexer: '^0.1.0', projectIndexSchema: 1 },
          rules: [
            {
              manifest: {
                id: '@acme/rules/require-owner',
                docs: { description: 'Require owner metadata.' },
                phase: 'index',
                requires: ['definitions'],
                fidelity: 'safe',
                defaultSeverity: 'warning',
              },
              messages: { missing: 'Missing owner.' },
              check: ({ definitions }) => definitions.map((definition) => lintFinding(`owner:${definition.id}`)),
            },
          ],
        }),
      ],
      graph: {
        definitions: [workflow],
        relations: [],
      },
    })

    expect(result.method).toBe('checkStaticRules')
    expect(result.outputs).toEqual([expect.objectContaining({ message: 'owner:@acme/workflow:publish' })])
    expect(result.diagnostics).toEqual([])
    expect(result.ruleDescriptors.map((descriptor) => descriptor.id)).toEqual(['@acme/rules/require-owner'])
    expect(result.facts).toEqual({
      lintFindings: [expect.objectContaining({ message: 'owner:@acme/workflow:publish' })],
      ruleDescriptors: [expect.objectContaining({ id: '@acme/rules/require-owner' })],
    })
  })

  it('checks built-in lints through the project worker host', async () => {
    const result = await checkStaticRulesForProject({
      root: '/project',
      graph: {
        definitions: [
          {
            id: 'prompt:missing-schema',
            kind: 'prompt',
            name: 'missing-schema',
            fidelity: 'resolved',
            status: 'active',
          },
        ],
        relations: [],
      },
    })

    expect(result.outputs.map((finding) => finding.ruleId)).toContain('prompt.missing_input_schema')
    expect(result.ruleDescriptors.map((descriptor) => descriptor.id)).toContain('prompt.missing_input_schema')
    expect(result.facts).toEqual({
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'index.config_not_found' })]),
      lintFindings: expect.arrayContaining([expect.objectContaining({ ruleId: 'prompt.missing_input_schema' })]),
    })
  })
})

function extension(input: IndexerExtension): IndexerExtension {
  return input
}

function lintFinding(id: string): IndexLintFinding {
  return indexLintFinding({
    ruleId: 'definition.missing_eval_coverage',
    key: id,
    message: id,
    relatedDefinitionIds: [],
    evidence: [],
  })
}
