import type { SetupMode, SetupReport } from '@use-crux/core/setup'
import type { RuntimeEngineDefinition } from '@use-crux/core/runtime'
import { loadProjectConfig } from './config'
import { createSetupPlanner } from '@use-crux/core/setup'
import { createRuntimeSetupContributor } from './setup/runtime-contributor'
import { createDeferSetupContributor } from './setup/defer-contributor'

export interface SetupOperationOptions { readonly root: string; readonly mode: SetupMode }

/** Run aggregate project setup through explicitly registered contributors. */
export async function runSetupOperation(options: SetupOperationOptions): Promise<SetupReport> {
  const { loaded } = await loadProjectConfig(options.root, undefined, 'runtime-rich')
  const runtime = loaded.crux?.config.runtime as RuntimeEngineDefinition | undefined
  const planner = createSetupPlanner([
    ...(runtime ? [createRuntimeSetupContributor(runtime)] : []),
    createDeferSetupContributor({ hasRuntime: runtime !== undefined }),
  ])
  const context = { root: options.root, mode: options.mode }
  return options.mode === 'apply' ? planner.apply(context) : options.mode === 'plan' ? planner.plan(context) : planner.check(context)
}
