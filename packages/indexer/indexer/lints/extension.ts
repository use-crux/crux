import type { IndexRule } from '../extensions'
import { indexLintFindings } from './findings'

/**
 * Runs the built-in Project Index lint analysis as an internal extension rule.
 *
 * The rule is deliberately a thin value adapter around `indexLintFindings(...)`: the existing lint
 * implementation remains pure and deterministic, while production indexing now executes it through the
 * same rule slot future first-party extensions will use.
 */
export const cruxIndexLintRule: IndexRule = {
  manifest: {
    id: 'crux.index-lints',
    docs: {
      description: 'Runs the built-in Project Index lint rules over resolved Crux definitions and relations.',
      url: '/docs/reference/crux-core/lint',
    },
    phase: 'index',
    requires: ['definitions', 'relations'],
    fidelity: 'safe',
    defaultSeverity: 'info',
    schema: { type: 'object', additionalProperties: false },
    defaultOptions: [],
  },
  messages: {
    finding: 'Project Index lint finding.',
  },
  check: ({ definitions, relations }) => indexLintFindings({ definitions, relations }),
}
