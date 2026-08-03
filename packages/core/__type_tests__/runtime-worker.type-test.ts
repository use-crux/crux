import { expectTypeOf } from 'vitest'
import {
  createRuntimeHandler,
  createRuntimeProgram,
  createRuntimeWorker,
  inMemoryRuntimeStore,
  node,
  type HostBoundRuntimeEngineDefinition,
  type InMemoryRuntimeStore,
  type ResolvedRuntimeEngine,
  type RuntimeWorker,
} from '@use-crux/core/runtime'

const program = createRuntimeProgram({ targets: [], transports: [] })
const runtime = node({
  store: inMemoryRuntimeStore(),
  namespace: 'type-test',
  autoStartMaintenance: false,
})

createRuntimeHandler({ program, runtime })
createRuntimeHandler({ targets: [], manifestHash: 'manual', runtime })

// @ts-expect-error A program and explicit targets are mutually exclusive.
createRuntimeHandler({ program, targets: [], runtime })
// @ts-expect-error A program's manifest hash cannot be overridden.
createRuntimeHandler({ program, manifestHash: 'override', runtime })
// @ts-expect-error One of program or targets is required.
createRuntimeHandler({ runtime })

const worker = createRuntimeWorker({ runtime, program })
expectTypeOf(worker).toMatchTypeOf<RuntimeWorker<InMemoryRuntimeStore>>()
expectTypeOf(worker.runtime).toEqualTypeOf<
  ResolvedRuntimeEngine<InMemoryRuntimeStore>
>()
expectTypeOf(worker.closed).toEqualTypeOf<Promise<void>>()

const hostRuntime: HostBoundRuntimeEngineDefinition = {
  kind: 'host-bound',
  id: 'type-test-host',
  host: 'type-test-host',
  capabilities: runtime.capabilities,
}
// @ts-expect-error Workers require an executable in-process Runtime definition.
createRuntimeWorker({ runtime: hostRuntime, program })

// @ts-expect-error Worker handles expose immutable lifecycle state.
worker.program = program
// @ts-expect-error Resolved worker runtimes are immutable references.
worker.runtime = worker.runtime
// @ts-expect-error Worker lifecycle methods are immutable function properties.
worker.stop = worker.stop

void worker.stop({ timeoutMs: 1 })
