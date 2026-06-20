import type { ProjectIndexSnapshot } from '@crux/core/project-index'
import type { IndexPatch } from '@crux/indexer'

/** Converts an AST/source patch into the previous-index shape consumed by semantic benchmarking. */
export function projectIndexSnapshotFromAstPatch(patch: IndexPatch): ProjectIndexSnapshot {
  return {
    schemaVersion: 1,
    project: patch.project,
    indexedAt: patch.finishedAt ?? patch.startedAt,
    prompts: patch.facts.prompts ? [...patch.facts.prompts] : [],
    contexts: patch.facts.contexts ? [...patch.facts.contexts] : [],
    tools: patch.facts.tools ? [...patch.facts.tools] : [],
    lint: patch.facts.lint,
    definitions: patch.facts.definitions ? [...patch.facts.definitions] : [],
    relations: patch.facts.relations ? [...patch.facts.relations] : [],
    diagnostics: patch.facts.diagnostics ? [...patch.facts.diagnostics] : [],
    lintFindings: patch.facts.lintFindings ? [...patch.facts.lintFindings] : [],
    ruleDescriptors: patch.facts.ruleDescriptors ? [...patch.facts.ruleDescriptors] : [],
    sources: patch.facts.sources ? [...patch.facts.sources] : [],
    sourceGraph: patch.facts.sourceGraph,
  }
}
