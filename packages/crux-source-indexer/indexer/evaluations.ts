import type { ProjectDefinition } from '@crux/core/catalog'
import type { EvalDef, FlowEvalDef, RagEvalDef } from '@crux/core/testing'
import type { QualitySuite } from '@crux/core/quality'
import { definition, safeId } from './definitions'

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
  })
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
