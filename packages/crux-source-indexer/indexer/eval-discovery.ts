import type {
  CatalogDiagnostic,
  CatalogSourceFile,
  ProjectDefinition,
  ProjectRelation,
} from '@crux/core/catalog'
import {
  isEvalDef,
  isFlowEvalDef,
  isRagEvalDef,
} from '@crux/core/testing'
import { definition, relation, safeId } from './definitions'
import { moduleImportFailedDiagnostic } from './diagnostics'
import {
  definitionFromEval,
  definitionFromRag,
  definitionFromSuite,
  flowPromptIds,
  isQualitySuite,
  ragTargetPromptId,
} from './evaluations'
import { codeFilesFromGlobs } from './files'
import { importUserModule, withCruxIndexMode } from './imports'
import { addSource } from './sources'

export interface RuntimeDiscoveryResult {
  definitions: ProjectDefinition[]
  relations: ProjectRelation[]
  failedImportFiles: string[]
}

export async function discoverRuntimeEvalDefinitions(
  root: string,
  patterns: string[],
  promptIds: ReadonlySet<string>,
  diagnostics: CatalogDiagnostic[],
  sources: Map<string, CatalogSourceFile>,
): Promise<RuntimeDiscoveryResult> {
  const definitions: ProjectDefinition[] = []
  const relations: ProjectRelation[] = []
  const failedImportFiles: string[] = []

  const evalModules = await discoverModules(root, patterns, diagnostics, sources)
  for (const moduleResult of evalModules) {
    if (!moduleResult.ok) {
      failedImportFiles.push(moduleResult.file)
      continue
    }
    for (const [exportName, value] of Object.entries(moduleResult.exports)) {
      if (isEvalDef(value)) {
        const definitionItem = await definitionFromEval(root, moduleResult.file, exportName, value)
        definitions.push(definitionItem)
        const promptId = value.prompt.id
        if (promptId && promptIds.has(promptId)) {
          relations.push(relation('eval.targets_prompt', definitionItem.id, `prompt:${promptId}`, moduleResult.file))
        }
      } else if (isFlowEvalDef(value)) {
        const definitionId = `eval.flow:${safeId(value.name || exportName)}`
        definitions.push(await definition(root, moduleResult.file, definitionId, 'eval.flow', value.name || exportName, value.description, {
          caseCount: value.cases.length,
          stepCount: value.steps.length,
          configCount: value.configs.length,
        }))
        for (const promptId of flowPromptIds(value)) {
          if (promptIds.has(promptId)) {
            relations.push(relation('eval.targets_prompt', definitionId, `prompt:${promptId}`, moduleResult.file))
          }
        }
      } else if (isRagEvalDef(value)) {
        definitions.push(await definitionFromRag(root, moduleResult.file, exportName, value))
        const targetPromptId = ragTargetPromptId(value)
        if (targetPromptId && promptIds.has(targetPromptId)) {
          relations.push(relation('eval.targets_prompt', `eval.rag:${safeId(value.id ?? exportName)}`, `prompt:${targetPromptId}`, moduleResult.file))
        }
      } else if (isQualitySuite(value)) {
        definitions.push(await definitionFromSuite(root, moduleResult.file, exportName, value))
      }
    }
  }

  return { definitions, relations, failedImportFiles }
}

async function discoverModules(
  root: string,
  patterns: string[],
  diagnostics: CatalogDiagnostic[],
  sources: Map<string, CatalogSourceFile>,
): Promise<Array<{ ok: true; file: string; exports: Record<string, unknown> } | { ok: false; file: string }>> {
  const files = codeFilesFromGlobs(root, patterns)
  const results: Array<{ ok: true; file: string; exports: Record<string, unknown> } | { ok: false; file: string }> = []
  for (const file of files) {
    addSource(sources, file, 'indexed')
    await withCruxIndexMode(async () => {
      try {
        const mod = await importUserModule(file, 4_000)
        results.push({ ok: true, file, exports: Object.fromEntries(Object.entries(mod).filter(([key]) => key !== 'default')) })
      } catch (error) {
        addSource(sources, file, 'error')
        diagnostics.push(moduleImportFailedDiagnostic(root, file, errorMessage(error)))
        results.push({ ok: false, file })
      }
    })
  }
  return results
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
