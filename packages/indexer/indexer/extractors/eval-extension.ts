import type { ProjectDefinition, ProjectDefinitionKind } from '@crux/core/project-index'
import { foldedIndexChild } from '../index-presentation'
import { facts, type IndexExtractor, type ExtractContext, type StaticObjectReader } from '../extensions'
import { internalStaticTraversal } from '../extensions/internal-traversal'

/**
 * Extracts evaluation, dataset, and suite definitions from Crux eval primitives.
 *
 * The extractor records coverage references, dataset case counts, and suite case children as facts so
 * index lints can reason about quality coverage without executing eval code.
 */
export const evalIndexExtractor: IndexExtractor = {
  name: 'eval',
  patterns: [
    { kind: 'call', name: 'evaluation' },
    { kind: 'call', name: 'flowEvaluation' },
    { kind: 'call', name: 'ragEvaluation' },
    { kind: 'call', name: 'ragDataset' },
    { kind: 'call', name: 'suite' },
  ],
  extract: (ctx) => {
    if (ctx.match.name === 'suite') return extractSuite(ctx)
    if (ctx.match.name === 'ragDataset') return extractDataset(ctx)
    return extractEvaluation(ctx)
  },
}

/** Extracts prompt/flow/RAG evaluation definitions and their coverage references. */
function extractEvaluation(ctx: ExtractContext) {
  if (!ctx.config) return { kind: 'none' as const }
  const kind = evaluationKind(ctx.match.name)
  if (!kind) return { kind: 'none' as const }
  const name =
    ctx.match.name === 'ragEvaluation'
      ? (ctx.config.string('id') ?? ctx.config.string('name'))
      : ctx.config.string('name')
  const id = `${kind}:${ctx.source.safeId(name ?? ctx.source.variableName)}`
  const coverage = evalCoverageRefs(ctx.config, evaluationDefaultField(ctx.match.name))
  return facts({
    definitions: [
      ctx.define.definition({
        variableName: ctx.source.variableName,
        id,
        kind,
        name: name ?? ctx.source.variableName,
        metadata: {
          exportName: ctx.source.variableName,
          covers: coverage.metadata,
        },
      }),
    ],
    references: coverage.refs.map((target) => ({
      type: 'eval.covers_definition',
      fromId: id,
      ...target,
    })),
  })
}

/** Extracts RAG dataset definitions with static case-count metadata when cases are object literals. */
function extractDataset(ctx: ExtractContext) {
  if (!ctx.config) return { kind: 'none' as const }
  const explicitId = ctx.config.string('id')
  const caseCount = ctx.config.objectArray('cases').length
  const id = `dataset:${ctx.source.safeId(explicitId ?? ctx.source.variableName)}`
  return facts({
    definitions: [
      ctx.define.definition({
        variableName: ctx.source.variableName,
        id,
        kind: 'dataset',
        name: explicitId ?? ctx.source.variableName,
        metadata: {
          exportName: ctx.source.variableName,
          ...(caseCount > 0 ? { caseCount } : {}),
          facts: {
            kind: 'dataset',
            ...(caseCount > 0 ? { caseCount } : {}),
          },
        },
      }),
    ],
  })
}

/** Extracts a suite definition plus folded suite-case children discovered in the suite callback. */
function extractSuite(ctx: ExtractContext) {
  const explicitId = ctx.args.string(0)
  const suiteName = explicitId ?? ctx.source.variableName
  const id = `suite:${ctx.source.safeId(suiteName)}`
  const cases = staticSuiteCases(ctx, id, suiteName)
  return facts({
    definitions: [
      ctx.define.definition({
        variableName: ctx.source.variableName,
        id,
        kind: 'suite',
        name: suiteName,
        metadata: {
          exportName: ctx.source.variableName,
          source: 'code',
          ...(cases.length > 0 ? { caseCount: cases.length } : {}),
          facts: {
            kind: 'suite',
            ...(cases.length > 0 ? { caseCount: cases.length } : {}),
          },
        },
      }),
      ...cases.map((testCase) => ({
        variableName: ctx.source.variableName,
        definition: testCase.definition,
      })),
    ],
    references: cases.map((testCase) => ({
      type: 'suite.includes_case',
      fromId: id,
      toId: testCase.definition.id,
    })),
  })
}

/**
 * Discovers suite cases from first-party traversal of the suite callback.
 *
 * This remains internal traversal rather than public visitor API; the output is a value list of child
 * definitions that the extractor can include in its fact packet.
 */
function staticSuiteCases(
  ctx: ExtractContext,
  suiteId: string,
  suiteName: string,
): Array<{ readonly definition: ProjectDefinition }> {
  const traversal = internalStaticTraversal(ctx)
  const testParam = traversal?.callbackParameterName(1)
  if (!traversal || !testParam) return []
  return traversal.collectCallsInArgument(1, { name: testParam }).flatMap((call, index) => {
    const [caseName] = call.stringArguments
    if (!caseName) return []
    const caseId = ctx.source.safeId(caseName)
    return [
      {
        definition: projectDefinitionFromContext(ctx, {
          id: `suite.case:${ctx.source.safeId(suiteName)}:${caseId}`,
          kind: 'suite.case',
          name: caseName,
          metadata: {
            suiteId: suiteName,
            caseId,
            facts: {
              kind: 'suite.case',
              suiteId: suiteName,
            },
            indexPresentation: foldedIndexChild({
              parentDefinitionId: suiteId,
              parentRelationType: 'suite.includes_case',
              role: 'case',
              order: index,
            }),
          },
        }),
      },
    ]
  })
}

/**
 * Normalizes coverage fields into unresolved references and human-readable metadata.
 *
 * Evaluation APIs historically accepted several aliases (`prompt`, `target`, `covers`, etc.). Keeping
 * that normalization here preserves current behavior while relation resolution remains centralized.
 */
function evalCoverageRefs(
  config: StaticObjectReader,
  defaultField: 'prompt' | 'flow' | 'rag',
): {
  readonly refs: ReadonlyArray<{ readonly toVariable?: string; readonly toId?: string }>
  readonly metadata?: readonly string[]
} {
  const fields = [defaultField, 'target', 'targets', 'definition', 'definitions', 'covers'] as const
  const refs = fields.flatMap((field): Array<{ readonly toVariable?: string; readonly toId?: string }> => {
    const single = config.identifier(field)
    return [
      ...(single ? [{ toVariable: single }] : []),
      ...config.identifierArray(field).map((item) => ({ toVariable: item })),
      ...config.stringArray(field).map((item) => (item.includes(':') ? { toId: item } : { toVariable: item })),
    ]
  })
  const metadata = fields.flatMap((field) => [
    ...[config.identifier(field)].filter(isString),
    ...config.identifierArray(field),
    ...config.stringArray(field),
  ])
  return { refs, ...(metadata.length > 0 ? { metadata } : {}) }
}

/** Maps an eval factory name to the index definition kind it contributes. */
function evaluationKind(callName: string): ProjectDefinitionKind | undefined {
  if (callName === 'evaluation') return 'eval.prompt'
  if (callName === 'flowEvaluation') return 'eval.flow'
  if (callName === 'ragEvaluation') return 'eval.rag'
  return undefined
}

/** Returns the primary coverage field implied by the specific eval factory. */
function evaluationDefaultField(callName: string): 'prompt' | 'flow' | 'rag' {
  if (callName === 'flowEvaluation') return 'flow'
  if (callName === 'ragEvaluation') return 'rag'
  return 'prompt'
}

/** Builds folded eval child definitions with the same source defaults as the parent extractor context. */
function projectDefinitionFromContext(
  ctx: ExtractContext,
  input: {
    readonly id: string
    readonly kind: ProjectDefinitionKind
    readonly name: string
    readonly metadata: Readonly<Record<string, unknown>>
  },
): ProjectDefinition {
  return ctx.define.definition({
    variableName: ctx.source.variableName,
    id: input.id,
    kind: input.kind,
    name: input.name,
    metadata: input.metadata,
  }).definition
}

/** Removes absent optional coverage values after conservative config reads. */
function isString(value: string | undefined): value is string {
  return typeof value === 'string'
}
