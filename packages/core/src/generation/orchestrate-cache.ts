/** Semantic-cache diagnostics owned by shared generation orchestration. */

import { warnMissingSemanticCachePlugin } from '../cache'
import type { AnyPromptConfig } from '../prompt/prompt-types'
import { getHooks } from '../runtime/runtime'

/** Warn when authored semantic caching has no runtime plugin installed. */
export function maybeWarnMissingSemanticCache(spec: {
  readonly promptId: string | undefined
  readonly promptConfig: AnyPromptConfig
}): void {
  const semantic = (spec.promptConfig as { cache?: { semantic?: unknown } })
    .cache?.semantic
  if (
    semantic !== undefined &&
    semantic !== false &&
    !getHooks().semanticCacheInstalled
  ) {
    warnMissingSemanticCachePlugin(spec.promptId)
  }
}
