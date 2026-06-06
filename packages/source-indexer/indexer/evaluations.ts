import type { ProjectDefinition, ProjectRelation } from '@crux/core/catalog'
import type { EvalDef, FlowEvalDef, RagDataset, RagEvalDef } from '@crux/core/testing'
import type { QualitySuite } from '@crux/core/quality'
import { foldedCatalogChild } from './catalog-presentation'
import { definition, relation, safeId } from './definitions'

export async function definitionFromEval(root: string, file: string, exportName: string, value: EvalDef): Promise<ProjectDefinition> {
  const id = `eval.prompt:${safeId(exportName)}`
  return definition(root, file, id, 'eval.prompt', value.prompt.id ?? exportName, undefined, {
    mode: value.mode,
    caseCount: value.cases.length,
    promptId: value.prompt.id,
    hasScores: Boolean(value.scores?.length),
    classifyFailures: value.classifyFailures,
  })
}

export async function definitionFromRag(root: string, file: string, exportName: string, value: RagEvalDef): Promise<ProjectDefinition> {
  const name = value.id ?? exportName
  return definition(root, file, `eval.rag:${safeId(name)}`, 'eval.rag', name, undefined, {
    datasetId: value.dataset.id,
    caseCount: value.dataset.cases.length,
    hasJudges: Boolean(value.judges && Object.keys(value.judges).length > 0),
  })
}

export async function definitionFromSuite(
  root: string,
  file: string,
  exportName: string,
  value: QualitySuite,
): Promise<ProjectDefinition> {
  return definition(root, file, `suite:${safeId(value.id)}`, 'suite', value.id || exportName, value.description, {
    source: value.source,
    caseCount: value.cases.length,
    facts: {
      kind: 'suite',
      caseCount: value.cases.length,
    },
  })
}

export async function definitionFromRagDataset(
  root: string,
  file: string,
  exportName: string,
  value: RagDataset,
): Promise<ProjectDefinition> {
  return definition(root, file, `dataset:${safeId(value.id)}`, 'dataset', value.id || exportName, value.description, {
    caseCount: value.cases.length,
    facts: {
      kind: 'dataset',
      caseCount: value.cases.length,
    },
  })
}

export async function definitionsFromSuite(
  root: string,
  file: string,
  exportName: string,
  value: QualitySuite,
): Promise<{ definitions: ProjectDefinition[]; relations: ProjectRelation[] }> {
  const suiteDefinition = await definitionFromSuite(root, file, exportName, value)
  const caseDefinitions = await Promise.all(
    value.cases.map((testCase) => {
      const caseId = safeId(testCase.id)
      return definition(root, file, `suite.case:${safeId(value.id)}:${caseId}`, 'suite.case', testCase.name ?? testCase.id, undefined, {
        suiteId: value.id,
        caseId,
        facts: {
          kind: 'suite.case',
          suiteId: value.id,
        },
        catalogPresentation: foldedCatalogChild({
          parentDefinitionId: suiteDefinition.id,
          parentRelationType: 'suite.includes_case',
          role: 'case',
        }),
        input: testCase.input,
        ...(testCase.expected === undefined ? {} : { expected: testCase.expected }),
        ...(testCase.tags === undefined ? {} : { tags: [...testCase.tags] }),
        ...(testCase.metadata === undefined ? {} : { metadata: testCase.metadata }),
      })
    }),
  )
  return {
    definitions: [suiteDefinition, ...caseDefinitions],
    relations: caseDefinitions.map((caseDefinition) => relation('suite.includes_case', suiteDefinition.id, caseDefinition.id, file)),
  }
}

export function isQualitySuite(value: unknown): value is QualitySuite {
  return (
    value != null &&
    typeof value === 'object' &&
    (value as { _tag?: unknown })._tag === 'QualitySuite' &&
    typeof (value as { id?: unknown }).id === 'string' &&
    Array.isArray((value as { cases?: unknown }).cases)
  )
}

export function isRagDataset(value: unknown): value is RagDataset {
  return (
    value != null &&
    typeof value === 'object' &&
    (value as { _tag?: unknown })._tag === 'RagDataset' &&
    typeof (value as { id?: unknown }).id === 'string' &&
    Array.isArray((value as { cases?: unknown }).cases)
  )
}

export function isPortableSuiteJson(value: unknown): value is {
  id: string
  description?: string
  cases: Array<{ id: string; name?: string; tags?: string[] }>
} {
  if (!value || typeof value !== 'object') return false
  const suite = value as { id?: unknown; cases?: unknown }
  return typeof suite.id === 'string' && Array.isArray(suite.cases)
}

export function flowPromptIds(value: FlowEvalDef): string[] {
  const ids: string[] = []
  for (const step of value.steps) {
    const prompt = (step as { prompt?: unknown }).prompt
    if (prompt && typeof prompt === 'object') {
      const id = (prompt as { id?: unknown; _tag?: unknown }).id
      if (typeof id === 'string') ids.push(id)
    }
  }
  return ids
}

export function ragTargetPromptId(value: RagEvalDef): string | undefined {
  const target = value.target as { prompt?: { id?: unknown } } | undefined
  const id = target?.prompt?.id
  return typeof id === 'string' ? id : undefined
}
