/** Source-reference adapters for authored execution scopes. @internal */

import { getPromptDefinitionSource } from '../prompt/prompt'
import type { ScopeSourceRef } from './types'

/** Reuse a prompt's existing definition-site metadata without recapturing it. */
export function promptScopeSourceRef(
  prompt: object,
): ScopeSourceRef | undefined {
  const source = getPromptDefinitionSource(prompt)
  if (!source) return undefined
  return {
    file: source.file,
    line: source.line,
  }
}
