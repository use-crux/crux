import { readFileSync } from 'node:fs'
import type { ProjectDefinition, ProjectDefinitionKind } from '@crux/core/project-index'
import { foldedIndexChild } from '../index-presentation'
import { facts, type IndexExtractor, type ExtractContext, type StaticObjectReader } from '../extensions'
import { assertionSitesFromSource } from '../evaluation-assertion-sites'

/**
 * Extracts Quality `evaluate()` definitions from source without executing it.
 *
 * The extractor records the task coverage reference, inline case counts, and
 * named-case children as facts so index lints can reason about quality
 * coverage before any import. Cases without an explicit `name` derive their
 * id from a content hash at runtime, so only named cases appear statically;
 * runtime discovery (the evaluation manifest) remains the source of truth.
 */
export const evalIndexExtractor: IndexExtractor = {
  name: 'eval',
  // `configArg: 1` binds the options object of the id-form `evaluate('id', { ... })`;
  // the options-form `evaluate({ ... })` falls back to the parser's default
  // first-object-literal binding.
  patterns: [{ kind: 'call', name: 'evaluate', configArg: 1 }],
  extract: (ctx) => extractEvaluation(ctx),
}

/** Extracts one `evaluate()` definition, its named cases, and task coverage. */
function extractEvaluation(ctx: ExtractContext) {
  if (!ctx.config) return { kind: 'none' as const }
  const explicitId = ctx.args.string(0)
  const name = explicitId ?? ctx.source.variableName
  const id = `evaluation:${ctx.source.safeId(name)}`
  const cases = ctx.config.objectArray('data')
  const namedCases = staticEvaluationCases(ctx, id, name, cases)
  const coverage = taskCoverageRefs(ctx.config)
  const assertionSites = staticAssertionSites(ctx)
  return facts({
    definitions: [
      ctx.define.definition({
        variableName: ctx.source.variableName,
        id,
        kind: 'evaluation',
        name,
        metadata: {
          exportName: ctx.source.variableName,
          explicitId: explicitId !== undefined,
          ...(cases.length > 0 ? { caseCount: cases.length } : {}),
          ...(coverage.metadata ? { covers: coverage.metadata } : {}),
          ...(assertionSites.length > 0 ? { assertionSites } : {}),
          facts: {
            kind: 'evaluation',
            ...(cases.length > 0 ? { caseCount: cases.length } : {}),
            ...(assertionSites.length > 0 ? { assertionSites } : {}),
          },
        },
      }),
      ...namedCases.map((testCase) => ({
        variableName: ctx.source.variableName,
        definition: testCase.definition,
      })),
    ],
    references: [
      ...namedCases.map((testCase) => ({
        type: 'evaluation.includes_case',
        fromId: id,
        toId: testCase.definition.id,
      })),
      ...coverage.refs.map((target) => ({
        type: 'eval.covers_definition',
        fromId: id,
        ...target,
      })),
    ],
  })
}

function staticAssertionSites(ctx: ExtractContext) {
  try {
    return assertionSitesFromSource({
      file: ctx.source.file,
      exportName: ctx.source.variableName,
      source: readFileSync(ctx.source.file, 'utf8'),
    })
  } catch {
    return []
  }
}

/** Builds folded child definitions for inline cases that carry an explicit `name`. */
function staticEvaluationCases(
  ctx: ExtractContext,
  evaluationDefinitionId: string,
  evaluationName: string,
  cases: readonly StaticObjectReader[],
): Array<{ readonly definition: ProjectDefinition }> {
  return cases.flatMap((caseReader, index) => {
    const caseName = caseReader.string('name')
    if (!caseName) return []
    const caseId = ctx.source.safeId(caseName)
    return [
      {
        definition: projectDefinitionFromContext(ctx, {
          id: `evaluation.case:${ctx.source.safeId(evaluationName)}:${caseId}`,
          kind: 'evaluation.case',
          name: caseName,
          metadata: {
            evaluationId: evaluationName,
            caseId,
            facts: {
              kind: 'evaluation.case',
              evaluationId: evaluationName,
            },
            indexPresentation: foldedIndexChild({
              parentDefinitionId: evaluationDefinitionId,
              parentRelationType: 'evaluation.includes_case',
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
 * Normalizes the `task:` field into unresolved coverage references.
 *
 * `task` accepts a primitive identifier (`task: writerPrompt`), a
 * `target.*()` wrapper, or a plain function — only identifier references can
 * be resolved statically; everything else stays opaque until runtime
 * discovery reads the manifest.
 */
function taskCoverageRefs(config: StaticObjectReader): {
  readonly refs: ReadonlyArray<{ readonly toVariable?: string; readonly toId?: string }>
  readonly metadata?: readonly string[]
} {
  const single = config.identifier('task')
  const refs = single ? [{ toVariable: single }] : []
  return { refs, ...(single ? { metadata: [single] } : {}) }
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
