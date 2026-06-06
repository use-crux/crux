import { stateResourceWriteWithoutReadFindings } from '../../catalog-lints'
import type { SemanticCatalogAnalyzer } from '../types'

/**
 * Catalog-level analyzer that derives lint facts from the merged semantic graph.
 */
export const semanticLintFactAnalyzer: SemanticCatalogAnalyzer = {
  name: 'lint-fact',
  analyzeCatalog(context) {
    return {
      lintFindings: stateResourceWriteWithoutReadFindings({
        definitions: context.definitions,
        relations: context.relations,
      }),
    }
  },
}
