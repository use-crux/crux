import { expectTypeOf, it } from 'vitest'
import { createGoogle } from '../index'
import type {
  CreateGoogleOptions,
  GoogleCachedContentCallOptions,
  GoogleCachedContentCreateOptions,
  GoogleCachedContentPort,
  GoogleExtra,
} from '../index'

type GoogleAdapter = ReturnType<typeof createGoogle>
type GoogleGenerateExtra = NonNullable<Parameters<GoogleAdapter['generate']>[1]['extra']>

expectTypeOf<CreateGoogleOptions['cachedContent']>().toEqualTypeOf<GoogleCachedContentCreateOptions | undefined>()
expectTypeOf<GoogleExtra['cachedContent']>().toEqualTypeOf<GoogleCachedContentCallOptions | undefined>()
expectTypeOf<GoogleGenerateExtra['cachedContent']>().toEqualTypeOf<GoogleCachedContentCallOptions | undefined>()

function acceptGenerateExtra(extra: GoogleGenerateExtra): GoogleGenerateExtra {
  return extra
}

acceptGenerateExtra({ cachedContent: { ttlSeconds: 60 } })

// @ts-expect-error Google CachedContent TTL overrides must be numeric seconds.
acceptGenerateExtra({ cachedContent: { ttlSeconds: '60' } })

const customPort = {
  async resolve(args) {
    expectTypeOf(args).toMatchTypeOf<Parameters<GoogleCachedContentPort['resolve']>[0]>()
    return undefined
  },
} satisfies GoogleCachedContentPort

const customPortOptions = {
  cachedContent: customPort,
} satisfies CreateGoogleOptions

expectTypeOf(customPortOptions.cachedContent).toMatchTypeOf<GoogleCachedContentPort>()

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
