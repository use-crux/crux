import { expectTypeOf, it } from 'vitest'
import { createGoogle } from '../index'
import type {
  CreateGoogleOptions,
  GoogleCachedContentCallOptions,
  GoogleCachedContentLifecycle,
  GoogleCachedContentOption,
  GoogleExtra,
} from '../index'

type GoogleAdapter = ReturnType<typeof createGoogle>
type GoogleGenerateExtra = NonNullable<Parameters<GoogleAdapter['generate']>[1]['extra']>

expectTypeOf<CreateGoogleOptions['cachedContent']>().toEqualTypeOf<GoogleCachedContentOption | undefined>()
expectTypeOf<GoogleExtra['cachedContent']>().toEqualTypeOf<GoogleCachedContentCallOptions | undefined>()
expectTypeOf<GoogleGenerateExtra['cachedContent']>().toEqualTypeOf<GoogleCachedContentCallOptions | undefined>()

function acceptGenerateExtra(extra: GoogleGenerateExtra): GoogleGenerateExtra {
  return extra
}

acceptGenerateExtra({ cachedContent: { ttlSeconds: 60 } })

// @ts-expect-error Google CachedContent TTL overrides must be numeric seconds.
acceptGenerateExtra({ cachedContent: { ttlSeconds: '60' } })

// A fully custom lifecycle is an accepted CachedContent option.
const customLifecycle: GoogleCachedContentLifecycle = {
  async prepare() {
    return { mode: 'inline', reason: 'disabled', config: {} }
  },
}
const customLifecycleOptions = { cachedContent: customLifecycle } satisfies CreateGoogleOptions
expectTypeOf(customLifecycleOptions.cachedContent).toMatchTypeOf<GoogleCachedContentLifecycle>()

// A tuning config (including a custom cache port) is also accepted.
const configOptions = {
  cachedContent: { defaultTtlSeconds: 600, maxEntries: 100, onError: 'throw' },
} satisfies CreateGoogleOptions
void configOptions

const cachedContentCallOptions = {
  cachedContent: { skip: true, ttlSeconds: 120 },
} satisfies GoogleExtra

expectTypeOf(cachedContentCallOptions.cachedContent).toEqualTypeOf<{
  skip: true
  ttlSeconds: number
}>()

// @ts-expect-error Google CachedContent supports only fallback or throw error policies.
const invalidErrorMode = { cachedContent: { onError: 'ignore' } } satisfies CreateGoogleOptions

// @ts-expect-error Google provider options use `cachedContent`, not `cache`.
const invalidCreateGoogleCacheAlias = { cache: false } satisfies CreateGoogleOptions

void invalidErrorMode
void invalidCreateGoogleCacheAlias

it('exposes the Google CachedContent type surface', () => {
  expectTypeOf<CreateGoogleOptions>().toMatchTypeOf<CreateGoogleOptions>()
})
