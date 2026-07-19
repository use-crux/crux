import {
  createSetupPlanner,
  defineSetupContributor,
  type SetupMode,
  type SetupReport,
} from '@use-crux/core/setup'
import type { RuntimeEngineDefinition } from '@use-crux/core/runtime'
import { loadProjectConfig } from './config'
import { createRuntimeSetupContributor } from './setup/runtime-contributor'
import { createDeferSetupContributor } from './setup/defer-contributor'

export interface SetupOperationOptions {
  readonly root: string
  readonly mode: SetupMode
}

/** Run aggregate project setup through explicitly registered contributors. */
export async function runSetupOperation(
  options: SetupOperationOptions,
): Promise<SetupReport> {
  const { loaded } = await loadProjectConfig(
    options.root,
    undefined,
    'runtime-rich',
  )
  const runtime = loaded.crux?.config.runtime as
    | RuntimeEngineDefinition
    | undefined
  const planner = createSetupPlanner([
    ...(loaded.importFailed ? [configFailureContributor()] : []),
    ...(runtime ? [createRuntimeSetupContributor(runtime)] : []),
    createDeferSetupContributor({
      runtime,
      host: loaded.crux?.config.host,
    }),
  ])
  const context = { root: options.root, mode: options.mode }
  switch (options.mode) {
    case 'apply':
      return planner.apply(context)
    case 'plan':
      return planner.plan(context)
    case 'check':
      return planner.check(context)
  }
}

function configFailureContributor() {
  return defineSetupContributor({
    id: 'project-config',
    inspect: async () => [
      {
        contributorId: 'project-config',
        code: 'SETUP_CONTRIBUTOR_FAILED',
        resource: 'crux.config',
        severity: 'error',
        message: 'The Crux project configuration could not be loaded.',
        remediation:
          'Fix the configuration import error, then rerun `crux setup`.',
      },
    ],
    plan: async () => [],
  })
}
