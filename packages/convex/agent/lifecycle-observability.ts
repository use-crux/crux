import type { ResolvedPrompt } from '@use-crux/core'
import { observe } from '@use-crux/core/observability'
import { DEFAULT_CONVEX_OBSERVABILITY_FLUSH_TIMEOUT_MS, flushObservability } from '../observability'
import type { ConvexRuntimeTarget } from '../runtime'
import type {
  ConvexAgentObserveArgs,
  ConvexAgentObserveConfig,
  ConvexAgentOperation,
  PreparedAgentCall,
} from './lifecycle-types'

const CONVEX_AGENT_START_FLUSH_TIMEOUT_MS = 1000
const CONVEX_AGENT_FINAL_FLUSH_TIMEOUT_MS = DEFAULT_CONVEX_OBSERVABILITY_FLUSH_TIMEOUT_MS

type PreparedAgentRecorder = (prepared: PreparedAgentCall, preparedTarget?: ConvexRuntimeTarget) => Promise<void>

/** Observe one high-level profile-backed agent operation. */
export async function observeAgentRun<R>(
  agentName: string,
  promptId: string | undefined,
  operation: ConvexAgentOperation,
  target: ConvexRuntimeTarget,
  config: ConvexAgentObserveConfig | undefined,
  fn: (recordPrepared: PreparedAgentRecorder) => Promise<R>,
): Promise<R> {
  if (config?.enabled === false) {
    return await fn(async () => undefined)
  }
  let preparedForEnd: PreparedAgentCall | undefined
  let targetForEnd = target
  const observeArgs = { agentName, promptId, operation, target }
  const spanName = await observeAgentRunName(config, observeArgs)
  const attributes = await observeAgentRunAttributes(config, observeArgs)
  const span = observe.openSpan({
    name: spanName,
    family: 'agent',
    primitive: 'agent.run',
    attributes: {
      ...attributes,
      ...agentRunAttributes(agentName, promptId, operation, target),
    },
  })
  const recordPrepared: PreparedAgentRecorder = async (prepared, preparedTarget) => {
    preparedForEnd = prepared
    targetForEnd = preparedTarget ?? targetForEnd
    emitAgentToolsRegistered(agentName, operation, prepared)
    await flushObservability({ timeoutMs: CONVEX_AGENT_START_FLUSH_TIMEOUT_MS })
  }
  try {
    return await span.withContext(async () => {
      await flushObservability({ timeoutMs: CONVEX_AGENT_START_FLUSH_TIMEOUT_MS })
      const result = await fn(recordPrepared)
      span.end({
        attributes: {
          ...attributes,
          ...(preparedForEnd
            ? preparedAgentRunAttributes(agentName, promptId, operation, targetForEnd, preparedForEnd)
            : agentRunAttributes(agentName, promptId, operation, targetForEnd)),
        },
      })
      return result
    })
  } catch (error) {
    span.error(
      error,
      {
        ...attributes,
        ...(preparedForEnd
          ? preparedAgentRunAttributes(agentName, promptId, operation, targetForEnd, preparedForEnd)
          : agentRunAttributes(agentName, promptId, operation, targetForEnd)),
      },
    )
    throw error
  } finally {
    await flushObservability({ timeoutMs: CONVEX_AGENT_FINAL_FLUSH_TIMEOUT_MS })
  }
}

async function observeAgentRunName(
  config: ConvexAgentObserveConfig | undefined,
  args: ConvexAgentObserveArgs,
): Promise<string> {
  if (!config?.name) return args.agentName
  return typeof config.name === 'function' ? await config.name(args) : config.name
}

async function observeAgentRunAttributes(
  config: ConvexAgentObserveConfig | undefined,
  args: ConvexAgentObserveArgs,
): Promise<Record<string, unknown>> {
  if (!config?.attributes) return {}
  return typeof config.attributes === 'function' ? await config.attributes(args) : config.attributes
}

function agentRunAttributes(
  agentName: string,
  promptId: string | undefined,
  operation: ConvexAgentOperation,
  target: ConvexRuntimeTarget,
): Record<string, unknown> {
  return {
    agentName,
    operation,
    source: 'convex.agent',
    ...(promptId ? { promptId } : {}),
    ...(target.threadId ? { threadId: target.threadId } : {}),
    ...(target.userId ? { userId: target.userId } : {}),
  }
}

function preparedAgentRunAttributes(
  agentName: string,
  promptId: string | undefined,
  operation: ConvexAgentOperation,
  target: ConvexRuntimeTarget,
  prepared: PreparedAgentCall,
): Record<string, unknown> {
  const toolNames = Object.keys(prepared.convexTools).sort()
  return {
    ...agentRunAttributes(agentName, promptId, operation, target),
    toolCount: toolNames.length,
    toolNames,
    contextSources: contextSources(prepared.resolved),
    memoryBindingCount: prepared.resolved.memoryBindings?.length ?? 0,
  }
}

function emitAgentToolsRegistered(
  agentName: string,
  operation: ConvexAgentOperation,
  prepared: PreparedAgentCall,
): void {
  const toolNames = Object.keys(prepared.convexTools).sort()
  observe.event({
    name: 'convex.agent.tools.registered',
    attributes: {
      agentName,
      operation,
      toolCount: toolNames.length,
      toolNames,
    },
  })
}

function contextSources(resolved: ResolvedPrompt): string[] {
  return (resolved.systemBlocks ?? [])
    .map((block) => block.source)
    .filter((source) => source.startsWith('context:'))
    .map((source) => source.slice('context:'.length))
}
