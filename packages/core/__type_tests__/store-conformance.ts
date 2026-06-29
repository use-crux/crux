import { expectTypeOf } from 'vitest'
import { inMemoryCruxStore, type CruxStore } from '@use-crux/core/store'
import { describeCruxStoreConformance } from '@use-crux/core/store/testing/vitest'
import type { DescribeCruxStoreConformanceOptions } from '@use-crux/core/store/testing/vitest'

expectTypeOf(describeCruxStoreConformance).parameter(0).toEqualTypeOf<DescribeCruxStoreConformanceOptions>()

const options: DescribeCruxStoreConformanceOptions = {
  name: 'type-test-store',
  prepare: () => inMemoryCruxStore(),
  supports: {
    ttl: true,
    vectorSearch: true,
  },
}

expectTypeOf(options.prepare()).toEqualTypeOf<CruxStore | Promise<CruxStore>>()

const invalidOptions: DescribeCruxStoreConformanceOptions = {
  name: 'invalid-store',
  prepare: () => inMemoryCruxStore(),
  // @ts-expect-error Conformance options intentionally constrain known optional capabilities.
  supports: { blobSearch: true },
}

void options
void invalidOptions
