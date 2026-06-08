import type { IndexRule } from './extensions'
import { indexLintFindings } from './index-lints'

/**
 * Runs the built-in Project Index lint analysis as an internal extension rule.
 *
 * The rule is deliberately a thin value adapter around `indexLintFindings(...)`: the existing lint
 * implementation remains pure and deterministic, while production indexing now executes it through the
 * same rule slot future first-party extensions will use.
 */
export const cruxIndexLintRule: IndexRule = {
  name: 'crux.index-lints',
  meta: {
    docs: {
      description: 'Runs the built-in Project Index lint rules over resolved Crux definitions and relations.',
      url: '/docs/reference/crux-core/lint',
    },
    schema: { type: 'object', additionalProperties: false },
    messages: {
      finding: 'Project Index lint finding.',
    },
    defaultOptions: [],
  },
  check: ({ definitions, relations }) => indexLintFindings({ definitions, relations }),
}
