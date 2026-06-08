import type { ProjectCatalogSnapshot, ProjectDefinition, ProjectRelation } from '@crux/core/catalog'
import { applyCatalogLintConfig } from '../catalog-lint-config'
import { applyCatalogLintSuppressions } from '../catalog-lint-suppressions'
import { astCatalogPatchFromCompilerResult, type ProjectCatalogCompilerResult } from '../compiler'
import { createProjectCatalogCompilerRuntime } from '../compiler/profile'
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
  const definitions: ProjectDefinition[] = []
  const relations: ProjectRelation[] = []
  const dependenciesByFile = new Map<string, string[]>()
  const graphBuilder = createCatalogGraphBuilder()
  const parsedFiles: string[] = []
  const extensionRuntime = createProjectCatalogCompilerRuntime().extensionRuntime

  for (const file of input.decision.affectedFiles) {
    if (input.decision.deletedFiles.includes(file)) continue
    const parsed = await parseStaticDefinitionsFromFactsCached(input.decision.root, file, staticFactParser)
    parsedFiles.push(file)
    dependenciesByFile.set(file, parsed.dependencies)
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
  const ruleResult = extensionRuntime.checkRules({ definitions, relations })
  const lintFindings = applyCatalogLintConfig({
    config: input.previousCatalog.lint,
    configFile: input.previousCatalog.project.configFile,
    diagnostics: [...ruleResult.diagnostics],
    findings: applyCatalogLintSuppressions({
      files: input.decision.affectedFiles,
      findings: ruleResult.outputs,
      diagnostics: [...ruleResult.diagnostics],
    }),
  })
  const sources = graphSources(graphBuilder.graph)
  const result: ProjectCatalogCompilerResult = {
    project: {
      root: input.decision.root,
      ...(input.projectName ? { name: input.projectName } : {}),
      ...(input.configPath ? { configFile: input.configPath } : {}),
    },
    indexedAt: input.startedAt,
    lint: input.previousCatalog.lint,
    facts: {
      lint: input.previousCatalog.lint,
      definitions,
      relations,
      diagnostics: [],
      lintFindings,
      sources,
      sourceGraph: input.previousCatalog.sourceGraph,
    },
    sources,
    graphEvidence: { dependenciesByFile },
    diagnostics: [],
    lintFindings,
    sourceGraph: input.previousCatalog.sourceGraph,
  }

  return {
    parsedFiles,
    patch: astCatalogPatchFromCompilerResult(result, {
      invalidates: catalogInvalidationFromDecision(input.decision),
      finishedAt: new Date().toISOString(),
    }),
  }
}

function previousDependents(previousCatalog: ProjectCatalogSnapshot, file: string): readonly string[] {
  return previousCatalog.sources.find((source) => source.file === file)?.dependents ?? []
}
