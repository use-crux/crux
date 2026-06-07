import type { ProjectCatalogSnapshot } from '@crux/core/catalog'
import { applyCatalogLintConfig } from '../catalog-lint-config'
import { applyCatalogLintSuppressions } from '../catalog-lint-suppressions'
import { catalogLintFindings } from '../catalog-lints'
import { createCatalogGraphBuilder, graphSources } from '../graph/builder'
import type { CatalogPatch } from '../patches'
import { parseStaticDefinitionsFromFactsCached } from '../static-cache'
import { staticFactParser } from '../static-parser'
import { catalogInvalidationFromDecision } from './invalidation'
import type { DependencyClosureReindexDecision, SourceFileReindexDecision } from './types'

type StaticExecutableDecision = SourceFileReindexDecision | DependencyClosureReindexDecision

interface StaticPartialPatchInput {
  readonly decision: StaticExecutableDecision
  readonly previousCatalog: ProjectCatalogSnapshot
  readonly projectName?: string
  readonly configPath?: string
  readonly startedAt: string
}

/**
 * Executes a planner-approved AST/source-only partial index and returns one exact-invalidation patch.
 */
export async function indexProjectAstPartial(input: StaticPartialPatchInput): Promise<{
  readonly patch: CatalogPatch
  readonly parsedFiles: readonly string[]
}> {
  const definitions = []
  const relations = []
  const graphBuilder = createCatalogGraphBuilder()
  const parsedFiles: string[] = []

  for (const file of input.decision.affectedFiles) {
    if (input.decision.deletedFiles.includes(file)) continue
    const parsed = await parseStaticDefinitionsFromFactsCached(input.decision.root, file, staticFactParser)
    parsedFiles.push(file)
    definitions.push(...parsed.definitions)
    relations.push(...parsed.relations)
    graphBuilder.addSource({
      source: {
        file,
        status: 'indexed',
        definitionIds: parsed.definitions.map((definition) => definition.id),
        dependencies: parsed.dependencies,
        dependents: [...previousDependents(input.previousCatalog, file)],
        diagnostics: [],
      },
    })
    parsed.definitions.forEach((definition) => graphBuilder.addDefinition({ definition }))
    parsed.relations.forEach((relation) => graphBuilder.addRelation({ relation }))
    parsed.dependencies.forEach((dependency) => graphBuilder.addDependency(file, dependency))
  }

  return {
    parsedFiles,
    patch: {
      schemaVersion: 1,
      phase: 'ast',
      project: {
        root: input.decision.root,
        ...(input.projectName ? { name: input.projectName } : {}),
        ...(input.configPath ? { configFile: input.configPath } : {}),
      },
      startedAt: input.startedAt,
      finishedAt: new Date().toISOString(),
      status: 'ok',
      invalidates: catalogInvalidationFromDecision(input.decision),
      facts: {
        definitions,
        relations,
        diagnostics: [],
        lintFindings: applyCatalogLintConfig({
          config: input.previousCatalog.lint,
          configFile: input.previousCatalog.project.configFile,
          diagnostics: [],
          findings: applyCatalogLintSuppressions({
            files: input.decision.affectedFiles,
            findings: catalogLintFindings({ definitions, relations }),
            diagnostics: [],
          }),
        }),
        sources: graphSources(graphBuilder.graph),
        sourceGraph: input.previousCatalog.sourceGraph,
      },
    },
  }
}

function previousDependents(previousCatalog: ProjectCatalogSnapshot, file: string): readonly string[] {
  return previousCatalog.sources.find((source) => source.file === file)?.dependents ?? []
}
