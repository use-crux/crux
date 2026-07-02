import { expectTypeOf } from 'vitest'
import type {
  HostBoundRuntimeEngineDefinition,
  RuntimeEngineDefinition,
} from '@use-crux/core/runtime'
import {
  CONVEX_RUNTIME_ENTRY,
  convex,
  type ConvexRuntimeEngineDefinition,
} from '../runtime'

const runtime = convex({ namespace: 'tenant-a' })

expectTypeOf(runtime).toEqualTypeOf<ConvexRuntimeEngineDefinition>()
expectTypeOf(runtime).toMatchTypeOf<RuntimeEngineDefinition>()
expectTypeOf(runtime).toMatchTypeOf<HostBoundRuntimeEngineDefinition>()
expectTypeOf(runtime.kind).toEqualTypeOf<'host-bound'>()
expectTypeOf(runtime.host).toEqualTypeOf<string>()
expectTypeOf(runtime.entry).toEqualTypeOf<string | undefined>()
expectTypeOf(CONVEX_RUNTIME_ENTRY).toEqualTypeOf<string>()

// @ts-expect-error Convex declarations bind stores only inside Convex handlers.
runtime.store
