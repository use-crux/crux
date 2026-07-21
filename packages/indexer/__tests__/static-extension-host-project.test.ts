import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkStaticRulesForProject,
  extractStaticEvidenceBatchForProject,
  loadStaticExtensionHostManifestForProject,
} from '../src/host/static-compat'

const roots: string[] = []
const testWorkspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('project Static Index extension host manifest', () => {
  it('loads configured TypeScript extractors and rules through config-policy mode', async () => {
    const root = await fixtureRoot()
    await linkWorkspacePackage(root, '@use-crux/core', 'packages/core')
    await writePackage(root, '@acme/crux-indexer-extension', {
      packageVersion: '1.0.0',
      source: `
        export default {
          name: '@acme/crux-indexer-extension',
          version: '1',
          crux: { indexer: '^0.1.0', projectIndexSchema: 1 },
          static: {
            evidence: { mode: 'declared' },
            interests: {
              calls: [{ name: 'defineWorkflow', importFrom: ['@acme/workflows'], configArg: 0 }]
            }
          },
          extractors: [
            {
              name: 'workflow.define',
              patterns: [{ kind: 'call', name: 'defineWorkflow', importFrom: ['@acme/workflows'], configArg: 0 }],
              extract(ctx) {
                const id = ctx.config?.string('id') ?? ctx.source.localName
                return {
                  kind: 'facts',
                  facts: {
                    definitions: [
                      ctx.define.definition({
                        variableName: ctx.source.variableName,
                        id: '@acme/workflow:' + ctx.source.safeId(id),
                        kind: '@acme/workflow',
                        name: id,
                      }),
                    ],
                  },
                }
              }
            }
          ],
          rules: [
            {
              manifest: {
                id: '@acme/crux-indexer-extension/require-owner',
                docs: { description: 'Require workflow owner metadata.' },
                phase: 'index',
                requires: ['definitions'],
                fidelity: 'safe',
                defaultSeverity: 'warning'
              },
              messages: { missing: 'Workflow owner is missing.' },
              check({ definitions }) {
                return definitions
                  .filter((definition) => definition.kind === '@acme/workflow')
                  .map((definition) => ({
                    id: 'lint:@acme/crux-indexer-extension/require-owner:' + definition.id,
                    ruleId: '@acme/crux-indexer-extension/require-owner',
                    severity: 'warning',
                    category: 'extension',
                    maturity: 'preview',
                    confidence: 'high',
                    title: 'Workflow owner is missing',
                    message: 'Workflow owner is missing.',
                    relatedDefinitionIds: [definition.id],
                    affectedDefinitionIds: [definition.id],
                    evidence: [{ kind: 'definition', definitionId: definition.id }],
                    fixes: [],
                  }))
              }
            }
          ]
        }
      `,
    })
    await writeFile(
      join(root, 'crux.config.ts'),
      [
        "import { config } from '@use-crux/core'",
        '',
        'export default config({',
        "  indexer: {",
        "    extensions: [{ package: '@acme/crux-indexer-extension', version: '^1.0.0' }],",
        "    trust: { mode: 'allowlisted', allow: ['@acme/crux-indexer-extension'] },",
        '  },',
        '})',
      ].join('\n'),
    )

    const result = await loadStaticExtensionHostManifestForProject({
      root,
      nativeCompilerProtocolVersion: 2,
    })

    expect(result.diagnostics).toEqual([])
    expect(result.manifest.callNames).toContain('defineWorkflow')
    expect(result.manifest.staticInterests.extractors).toEqual([
      expect.objectContaining({
        extension: { name: '@acme/crux-indexer-extension', version: '1' },
        name: 'workflow.define',
        calls: [expect.objectContaining({ name: 'defineWorkflow', configArg: 0 })],
      }),
    ])
    expect(result.manifest.staticHost).toMatchObject({
      extensionTypeScriptExtractorCount: 1,
      typeScriptRuleCount: 1,
      requiresTypeScriptHostForExtensions: true,
      requiresTypeScriptHostForRules: true,
      nativeOnlyEligible: false,
    })
    expect(result.ruleDescriptors).toEqual([
      expect.objectContaining({ id: '@acme/crux-indexer-extension/require-owner', source: 'extension' }),
    ])

    const evidence = await extractStaticEvidenceBatchForProject({
      root,
      jobs: [
        {
          id: 'job:workflow',
          extractor: {
            extension: { name: '@acme/crux-indexer-extension', version: '1' },
            name: 'workflow.define',
          },
          file: join(root, 'src', 'workflow.ts'),
          sourceHash: 'sha256:test',
          evidence: {
            kind: 'call',
            variableName: 'publishWorkflow',
            localName: 'publishWorkflow',
            exported: true,
            source: { file: 'src/workflow.ts', line: 1 },
            callee: { name: 'defineWorkflow', moduleSpecifier: '@acme/workflows' },
            args: [
              {
                kind: 'object',
                source: { file: 'src/workflow.ts', line: 1 },
                properties: [
                  {
                    name: 'id',
                    value: { kind: 'literal', value: 'publish' },
                    shorthand: false,
                    source: { file: 'src/workflow.ts', line: 1 },
                  },
                ],
              },
            ],
            objectArg: {
              kind: 'object',
              source: { file: 'src/workflow.ts', line: 1 },
              properties: [
                {
                  name: 'id',
                  value: { kind: 'literal', value: 'publish' },
                  shorthand: false,
                  source: { file: 'src/workflow.ts', line: 1 },
                },
              ],
            },
          },
        },
      ],
    })

    expect(evidence.diagnostics).toEqual([])
    expect(evidence.facts.definitions).toEqual([
      expect.objectContaining({ id: '@acme/workflow:publish', kind: '@acme/workflow' }),
    ])

    const rules = await checkStaticRulesForProject({
      root,
      graph: { definitions: evidence.facts.definitions ?? [], relations: [] },
    })

    expect(rules.diagnostics).toEqual([])
    expect(rules.facts.lintFindings).toEqual([
      expect.objectContaining({ ruleId: '@acme/crux-indexer-extension/require-owner' }),
    ])
  })
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(testWorkspaceRoot, '.tmp-static-extension-host-project-'))
  roots.push(root)
  return root
}

async function writePackage(
  root: string,
  name: string,
  input: {
    readonly packageVersion: string
    readonly source: string
  },
): Promise<void> {
  const packageRoot = join(root, 'node_modules', ...name.split('/'))
  await mkdir(packageRoot, { recursive: true })
  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name, version: input.packageVersion, type: 'module', exports: './index.mjs' }),
  )
  await writeFile(join(packageRoot, 'index.mjs'), input.source)
}

async function linkWorkspacePackage(root: string, name: string, workspaceRelativePath: string): Promise<void> {
  const packageRoot = join(root, 'node_modules', ...name.split('/'))
  await mkdir(join(packageRoot, '..'), { recursive: true })
  await symlink(join(process.cwd(), workspaceRelativePath), packageRoot, 'dir')
}
