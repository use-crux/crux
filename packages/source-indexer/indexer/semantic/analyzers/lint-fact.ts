import { stateResourceWriteWithoutReadFindings } from '../../catalog-lints'
import type { SemanticCatalogAnalyzer } from '../types'

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
