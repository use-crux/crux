/**
 * Type tests for the split context memo/provider cache authoring surface.
 */

import { z } from 'zod'
import { context, prompt } from '../prompt'

context({
  id: 'memoized',
  input: z.object({ orgId: z.string() }),
  system: ({ input }) => input.orgId,
  memo: { ttl: 300_000 },
})

context({
  id: 'provider-cached',
  system: 'Stable provider prefix.',
  cache: true,
})

prompt({
  id: 'provider-system-cache',
  system: 'Stable prompt identity.',
  cache: { provider: true },
})

// @ts-expect-error - resolver memoization moved from cache shorthands to `memo`.
context({ id: 'old-number-cache', system: () => 'x', cache: 300_000 })

// @ts-expect-error - object cache options were replaced by `memo` and `cache: true`.
context({ id: 'old-object-cache', system: () => 'x', cache: { ttl: 300_000 } })
