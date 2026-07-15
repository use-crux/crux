import { createAsyncScopeFacet } from '@use-crux/core/internal/async-scope'
import { channelHasSubscribers } from '@use-crux/core/observability'

if ('process' in globalThis || 'require' in globalThis || 'Buffer' in globalThis) {
  throw new Error('Portability smoke unexpectedly has Node globals.')
}

const facet = createAsyncScopeFacet<string>('portability-smoke')
if (facet.run('active', () => facet.current()) !== 'active') {
  throw new Error('Synchronous async-scope fallback did not initialize.')
}

channelHasSubscribers()
;(globalThis as { __cruxPortabilitySmoke?: string }).__cruxPortabilitySmoke = 'ok'
