import type { CatalogRule } from './extensions'
import { catalogLintFindings } from './catalog-lints'

/**
 * Runs the built-in Project Catalog lint analysis as an internal extension rule.
 *
 * The rule is deliberately a thin value adapter around `catalogLintFindings(...)`: the existing lint
 * implementation remains pure and deterministic, while production indexing now executes it through the
 * same rule slot future first-party extensions will use.
 */
export const cruxCatalogLintRule: CatalogRule = {
  name: 'crux.catalog-lints',
  meta: {
    docs: {
      description: 'Runs the built-in Project Catalog lint rules over resolved Crux definitions and relations.',
      url: '/docs/reference/crux-core/lint',
    },
    schema: { type: 'object', additionalProperties: false },
    messages: {
      finding: 'Project Catalog lint finding.',
    },
    defaultOptions: [],
  },
  check: ({ definitions, relations }) => catalogLintFindings({ definitions, relations }),
}
