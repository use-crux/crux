import { expectTypeOf } from 'vitest'
import type { CruxStore } from '@use-crux/core/store'
import type { CruxTransport } from '@use-crux/react'
import {
  createInMemoryConvexStoreDocumentComponent,
  defineConvexStoreContract,
  type ComponentDocumentPort,
  type ConvexCruxStoreComponent,
  type ConvexCtxPort,
  type ConvexStoreContract,
  type StoreDocRecord,
} from '../index'

interface TenantCtx extends ConvexCtxPort {
  readonly tenantId: string
}

const component = {
  memory: {
    get: 'memory:get',
    list: 'memory:list',
    set: 'memory:set',
    insert: 'memory:insert',
    remove: 'memory:remove',
  },
} satisfies ConvexCruxStoreComponent

const contract = defineConvexStoreContract<TenantCtx>({ component })

expectTypeOf(contract).toEqualTypeOf<ConvexStoreContract<TenantCtx>>()
expectTypeOf(contract.store).parameter(0).toEqualTypeOf<TenantCtx>()
expectTypeOf(contract.store({} as TenantCtx)).toEqualTypeOf<CruxStore>()
expectTypeOf(
  contract.transport({
    useQuery: () => undefined,
  }),
).toEqualTypeOf<CruxTransport>()

// @ts-expect-error Store creation preserves the caller's required ctx fields.
contract.store({ runQuery: async () => null, runMutation: async () => null })

const inMemoryComponent = createInMemoryConvexStoreDocumentComponent()
const inMemoryContract = defineConvexStoreContract({
  component: inMemoryComponent,
})

expectTypeOf(inMemoryContract).toEqualTypeOf<ConvexStoreContract<ConvexCtxPort>>()
expectTypeOf(
  inMemoryComponent.io(inMemoryComponent.ctx, {
    vectorIndexName: 'by_embedding',
  }),
).toEqualTypeOf<ComponentDocumentPort<StoreDocRecord>>()
