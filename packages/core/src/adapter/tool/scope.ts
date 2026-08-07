/** Tool execution-scope boundary shared by both adapter loop regimes. */

import { runScope } from '../../scope/kernel'
import type { RequestReceipt } from '../../request/receipt/receipt'
import { runWithEffectJournalContext } from '../../effect/internal/journal-context'
import type { EffectJournalLinker } from '../../effect/internal/journal-context'

/** Journal identity available while one accepted tool call executes. */
export interface ToolScopeOptions {
  readonly toolCallId: string
  readonly request?: RequestReceipt
  readonly retainEffectLinks?: (linkers: readonly EffectJournalLinker[]) => void
}

/** Run one accepted tool call inside its nearest-close execution scope. */
export function runToolScope<R>(
  name: string,
  execute: () => R | PromiseLike<R>,
  options?: ToolScopeOptions,
): Promise<Awaited<R>> {
  return runScope({ kind: 'tool', name }, {}, () =>
    options
      ? runWithEffectJournalContext(
          options.request,
          options.toolCallId,
          execute,
          options.retainEffectLinks,
        )
      : execute(),
  )
}
