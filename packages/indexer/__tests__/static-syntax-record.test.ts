import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  createTypeScriptStaticSyntaxFrontend,
  type StaticSyntaxFileRecord,
} from '../indexer/static/syntax-record'

describe('static syntax records', () => {
  it('emits a JSON-safe record for an exported imported factory call', async () => {
    const frontend = createTypeScriptStaticSyntaxFrontend({
      callNames: ['defineWorkflow'],
    })

    const record = await frontend.parseFile({
      root: '/repo',
      file: '/repo/src/workflow.ts',
      source: [
        "import { defineWorkflow as workflowFactory } from '@acme/workflows'",
        "import { prompt } from './prompts'",
        '',
        "export const workflow = workflowFactory({ id: 'release', enabled: true, steps: [prompt] })",
        '',
      ].join('\n'),
    })

    expect(record.schemaVersion).toBe(1)
    expect(record.frontend).toEqual({ name: 'typescript', version: ts.version })
    expect(record.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localName: 'workflowFactory',
          importedName: 'defineWorkflow',
          moduleSpecifier: '@acme/workflows',
        }),
        expect.objectContaining({
          localName: 'prompt',
          importedName: 'prompt',
          moduleSpecifier: './prompts',
        }),
      ]),
    )
    expect(record.matches).toEqual([
      expect.objectContaining({
        kind: 'call',
        exported: true,
        variableName: 'workflow',
        callee: expect.objectContaining({
          name: 'defineWorkflow',
          localName: 'workflowFactory',
          importedName: 'defineWorkflow',
          moduleSpecifier: '@acme/workflows',
        }),
        objectArg: expect.objectContaining({
          kind: 'object',
          properties: expect.arrayContaining([
            expect.objectContaining({
              name: 'id',
              value: { kind: 'literal', value: 'release' },
            }),
            expect.objectContaining({
              name: 'enabled',
              value: { kind: 'literal', value: true },
            }),
          ]),
        }),
      }),
    ])
    expect(record.diagnostics).toEqual([])
    expect(JSON.parse(JSON.stringify(record))).toEqual(record)
  })

  it('records local factory initializers, standalone call sites, and Agent constructors', async () => {
    const frontend = createTypeScriptStaticSyntaxFrontend({
      callNames: ['defineWorkflow'],
    })

    const record = await frontend.parseFile({
      root: '/repo',
      file: '/repo/src/agents.ts',
      source: [
        "const local = defineWorkflow({ id: 'local' })",
        "defineWorkflow({ id: 'inline' })",
        "const agent = new Agent({ name: 'planner' })",
        '',
      ].join('\n'),
    })

    expect(record.matches).toEqual([
      expect.objectContaining({
        kind: 'call',
        exported: false,
        variableName: 'local',
        localName: 'src/agents.ts:local',
        callee: expect.objectContaining({ name: 'defineWorkflow' }),
      }),
      expect.objectContaining({
        kind: 'call',
        exported: false,
        variableName: 'defineWorkflow-2',
        localName: 'src/agents.ts:defineWorkflow-2',
        callee: expect.objectContaining({ name: 'defineWorkflow' }),
      }),
      expect.objectContaining({
        kind: 'new',
        exported: false,
        variableName: 'agent',
        localName: 'src/agents.ts:agent',
        callee: expect.objectContaining({ name: 'Agent' }),
      }),
    ])
  })

  it('uses import-qualified interests to avoid unrelated same-name call matches', async () => {
    const input = {
      root: '/repo',
      file: '/repo/src/workflow.ts',
      source: [
        "import { defineWorkflow as workflowFactory } from '@acme/workflows'",
        "import { defineWorkflow as otherWorkflowFactory } from '@other/workflows'",
        '',
        "const local = defineWorkflow({ id: 'local' })",
        "const acme = workflowFactory({ id: 'acme' })",
        "const other = otherWorkflowFactory({ id: 'other' })",
      ].join('\n'),
    }
    const options = {
      callNames: ['defineWorkflow'],
      callInterests: [{ name: 'defineWorkflow', importFrom: ['@acme/workflows'] }],
    }

    const typescriptRecord = await createTypeScriptStaticSyntaxFrontend(options).parseFile(input)

    expect(typescriptRecord.matches.map((match) => match.variableName)).toEqual(['acme'])
  })

  it('prunes object evidence to declared config fields for sliced extension interests', async () => {
    const input = {
      root: '/repo',
      file: '/repo/src/policy.ts',
      source: [
        "import { definePolicy } from '@acme/policy'",
        "const checkAccess = () => workspace.writeFile('audit.log', 'tenant')",
        "export const policy = definePolicy('tenant', {",
        "  id: 'tenant-policy',",
        "  secret: 'drop-me',",
        '  target: agentOne,',
        '  check: checkAccess,',
        '})',
      ].join('\n'),
    }
    const options = {
      callInterests: [
        {
          name: 'definePolicy',
          importFrom: ['@acme/policy'],
          configArg: 1,
          properties: ['id'],
          callbacks: [{ property: 'check', maxDepth: 1 }],
          source: 'manifest' as const,
        },
      ],
    }

    const typescriptRecord = await createTypeScriptStaticSyntaxFrontend(options).parseFile(input)

    expect(objectPropertyNames(typescriptRecord)).toEqual(['id', 'check'])
  })
})

function objectPropertyNames(record: StaticSyntaxFileRecord): readonly string[] {
  const match = record.matches[0]
  if (!match || match.kind === 'object') return []
  return match.objectArg?.properties.map((property) => property.name) ?? []
}
