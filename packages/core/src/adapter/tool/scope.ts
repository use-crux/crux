/** Tool execution-scope boundary shared by both adapter loop regimes. */

import { runScope } from '../../scope/kernel'

/** Run one accepted tool call inside its nearest-close execution scope. */
export function runToolScope<R>(
  name: string,
  execute: () => R | PromiseLike<R>,
): Promise<Awaited<R>> {
  return runScope({ kind: 'tool', name }, {}, () => execute())
}
