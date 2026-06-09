import { staticFoundDefinitionsFromExtractedFacts } from '../extensions/static-normalizer'
import { relationDiagnosticsFromReport, resolveRelationModel } from '../relations/index'
import type { StaticFactParseResult, StaticParseResult } from './types'

/**
 * Projects fact-first static extraction output through the relation model facade.
 *
 * Static extraction still owns parsing and fact normalization; relation binding,
 * identity merging, and definition enrichment now live behind `resolveRelationModel`
 * so file-scope and project-scope callers cannot drift into different pipelines.
 */
export function staticParseResultFromFacts(input: StaticFactParseResult): StaticParseResult {
  const found = staticFoundDefinitionsFromExtractedFacts(input.facts)
  const model = resolveRelationModel({
    found,
    importedDefinitions: input.importedDefinitions,
    definitions: [...found.flatMap((item) => [item.definition, ...(item.extraDefinitions ?? [])]), ...input.pathDefinitions],
  })
  return {
    definitions: [...model.definitions],
    relations: [...model.relations],
    diagnostics: [...input.diagnostics, ...relationDiagnosticsFromReport(model.report)],
    dependencies: input.dependencies,
  }
}
