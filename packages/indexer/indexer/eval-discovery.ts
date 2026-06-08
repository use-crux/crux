import type { IndexDiagnostic, IndexSourceFile, ProjectDefinition, ProjectRelation } from '@crux/core/project-index'
import { isEvalDef, isFlowEvalDef, isRagEvalDef } from '@crux/core/testing'
import { definition, relation, safeId } from './definitions'
import { moduleImportFailedDiagnostic } from './diagnostics'
import {
  definitionFromEval,
  definitionFromRagDataset,
  definitionFromRag,
  definitionsFromSuite,
  flowPromptIds,
  isQualitySuite,
  isRagDataset,
  ragTargetPromptId,
} from './evaluations'
import { codeFilesFromGlobs } from './files'
import { importUserModule, withCruxIndexMode } from './imports'
import { sourceStatus } from './sources'

export interface RuntimeDiscoveryResult {
  definitions: ProjectDefinition[]
  relations: ProjectRelation[]
  failedImportFiles: string[]
  diagnostics: IndexDiagnostic[]
  sources: readonly IndexSourceFile[]
}

export async function discoverRuntimeEvalDefinitions(
  root: string,
  patterns: string[],
  promptIds: ReadonlySet<string>,
  sources: readonly IndexSourceFile[],
): Promise<RuntimeDiscoveryResult> {
  const definitions: ProjectDefinition[] = []
  const relations: ProjectRelation[] = []
  const failedImportFiles: string[] = []

  const evalModules = await discoverModules(root, patterns, sources)
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
        definitions.push(
          await definition(
            root,
            moduleResult.file,
            definitionId,
            'eval.flow',
            value.name || exportName,
            value.description,
            {
              caseCount: value.cases.length,
              stepCount: value.steps.length,
              configCount: value.configs.length,
            },
          ),
        )
        for (const promptId of flowPromptIds(value)) {
          if (promptIds.has(promptId)) {
            relations.push(relation('eval.targets_prompt', definitionId, `prompt:${promptId}`, moduleResult.file))
          }
        }
      } else if (isRagEvalDef(value)) {
        definitions.push(await definitionFromRag(root, moduleResult.file, exportName, value))
        const targetPromptId = ragTargetPromptId(value)
        if (targetPromptId && promptIds.has(targetPromptId)) {
          relations.push(
            relation(
              'eval.targets_prompt',
              `eval.rag:${safeId(value.id ?? exportName)}`,
              `prompt:${targetPromptId}`,
              moduleResult.file,
            ),
          )
        }
      } else if (isQualitySuite(value)) {
        const discovered = await definitionsFromSuite(root, moduleResult.file, exportName, value)
        definitions.push(...discovered.definitions)
        relations.push(...discovered.relations)
      } else if (isRagDataset(value)) {
        definitions.push(await definitionFromRagDataset(root, moduleResult.file, exportName, value))
      }
    }
  }

  return {
    definitions,
    relations,
    failedImportFiles,
    diagnostics: evalModules.flatMap((moduleResult) => moduleResult.diagnostics),
    sources: evalModules.at(-1)?.sources ?? sources,
  }
}

async function discoverModules(
  root: string,
  patterns: string[],
  sources: readonly IndexSourceFile[],
): Promise<
  Array<
    | {
        ok: true
        file: string
        exports: Record<string, unknown>
        diagnostics: readonly IndexDiagnostic[]
        sources: readonly IndexSourceFile[]
      }
    | { ok: false; file: string; diagnostics: readonly IndexDiagnostic[]; sources: readonly IndexSourceFile[] }
  >
> {
  const files = codeFilesFromGlobs(root, patterns)
  const results: Array<
    | {
        ok: true
        file: string
        exports: Record<string, unknown>
        diagnostics: readonly IndexDiagnostic[]
        sources: readonly IndexSourceFile[]
      }
    | { ok: false; file: string; diagnostics: readonly IndexDiagnostic[]; sources: readonly IndexSourceFile[] }
  > = []
  let nextSources = sources
  for (const file of files) {
    nextSources = sourceStatus(nextSources, file, 'indexed')
    await withCruxIndexMode(async () => {
      try {
        const mod = await importUserModule(file, 4_000)
        results.push({
          ok: true,
          file,
          exports: Object.fromEntries(Object.entries(mod).filter(([key]) => key !== 'default')),
          diagnostics: [],
          sources: nextSources,
        })
      } catch (error) {
        nextSources = sourceStatus(nextSources, file, 'error')
        results.push({
          ok: false,
          file,
          diagnostics: [moduleImportFailedDiagnostic(root, file, errorMessage(error))],
          sources: nextSources,
        })
      }
    })
  }
  return results
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
