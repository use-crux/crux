import { stateResourceWriteWithoutReadFindings } from '../../lints/findings'
import type { SemanticIndexAnalyzer } from '../types'

/**
 * Index-level analyzer that derives lint facts from the merged semantic graph.
 */
export const semanticLintFactAnalyzer: SemanticIndexAnalyzer = {
  name: 'lint-fact',
  analyzeIndex(context) {
    return {
      lintFindings: stateResourceWriteWithoutReadFindings({
        definitions: context.definitions,
        relations: context.relations,
      }),
    }
  },
}
