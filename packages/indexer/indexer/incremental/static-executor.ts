import type { ProjectIndexSnapshot, ProjectDefinition, ProjectRelation } from '@crux/core/project-index'
import { applyIndexLintConfig } from '../index-lint-config'
import { applyIndexLintSuppressions } from '../index-lint-suppressions'
import { builtInIndexRuleCatalog } from '../index-lint-rules'
import { astIndexPatchFromCompilerResult, type ProjectIndexCompilerResult } from '../compiler'
import { createProjectIndexCompilerRuntime } from '../compiler/profile'
import { createIndexGraphBuilder, graphSources } from '../graph/builder'
import type { IndexPatch } from '../patches'
import { parseStaticDefinitionsFromFactsCached } from '../static-cache'
import { staticFactParser } from '../static-parser'
import { indexInvalidationFromDecision } from './invalidation'
import type { DependencyClosureReindexDecision, SourceFileReindexDecision } from './types'

type StaticExecutableDecision = SourceFileReindexDecision | DependencyClosureReindexDecision

interface StaticPartialPatchInput {
  readonly decision: StaticExecutableDecision
  readonly previousIndex: ProjectIndexSnapshot
  readonly projectName?: string
  readonly configPath?: string
  readonly startedAt: string
}

/**
 * Executes a planner-approved AST/source-only partial index and returns one exact-invalidation patch.
 */
export async function indexProjectAstPartial(input: StaticPartialPatchInput): Promise<{
  readonly patch: IndexPatch
  readonly parsedFiles: readonly string[]
}> {
  const definitions: ProjectDefinition[] = []
  const relations: ProjectRelation[] = []
  const dependenciesByFile = new Map<string, string[]>()
  const graphBuilder = createIndexGraphBuilder()
  const parsedFiles: string[] = []
  const extensionRuntime = createProjectIndexCompilerRuntime().extensionRuntime

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
        dependents: [...previousDependents(input.previousIndex, file)],
        diagnostics: [],
      },
    })
    parsed.definitions.forEach((definition) => graphBuilder.addDefinition({ definition }))
    parsed.relations.forEach((relation) => graphBuilder.addRelation({ relation }))
    parsed.dependencies.forEach((dependency) => graphBuilder.addDependency(file, dependency))
  }
  const ruleResult = extensionRuntime.checkRules({ definitions, relations })
  const ruleCatalog = [...builtInIndexRuleCatalog(), ...extensionRuntime.ruleCatalog]
  const lintFindings = applyIndexLintConfig({
    config: input.previousIndex.lint,
    configFile: input.previousIndex.project.configFile,
    diagnostics: [...ruleResult.diagnostics],
    findings: applyIndexLintSuppressions({
      files: input.decision.affectedFiles,
      findings: ruleResult.outputs,
      diagnostics: [...ruleResult.diagnostics],
    }),
  })
  const sources = graphSources(graphBuilder.graph)
  const result: ProjectIndexCompilerResult = {
    project: {
      root: input.decision.root,
      ...(input.projectName ? { name: input.projectName } : {}),
      ...(input.configPath ? { configFile: input.configPath } : {}),
    },
    indexedAt: input.startedAt,
    lint: input.previousIndex.lint,
    facts: {
      lint: input.previousIndex.lint,
      definitions,
      relations,
      diagnostics: [],
      lintFindings,
      ruleCatalog,
      sources,
      sourceGraph: input.previousIndex.sourceGraph,
    },
    sources,
    graphEvidence: { dependenciesByFile },
    diagnostics: [],
    lintFindings,
    ruleCatalog,
    sourceGraph: input.previousIndex.sourceGraph,
  }

  return {
    parsedFiles,
    patch: astIndexPatchFromCompilerResult(result, {
      invalidates: indexInvalidationFromDecision(input.decision),
      finishedAt: new Date().toISOString(),
    }),
  }
}

function previousDependents(previousIndex: ProjectIndexSnapshot, file: string): readonly string[] {
  return previousIndex.sources.find((source) => source.file === file)?.dependents ?? []
}
