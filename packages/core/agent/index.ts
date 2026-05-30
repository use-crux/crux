/**
 * `@crux/core/agent` — Inter-agent coordination primitives.
 *
 * Provides a shared blackboard for multi-agent state, structured
 * handoffs for context transfer between agents, and delegates for
 * orchestration with subagent execution.
 *
 * @module
 */

export { blackboard } from './blackboard'
export type { Blackboard, BlackboardConfig, BlackboardContextOptions, BlackboardToolOptions } from './blackboard'

export { handoff } from './handoff'
export type { HandoffInstance, HandoffConfig, HandoffPayload } from './handoff'

export { delegate } from './delegate'
export type { Delegate, DelegateConfig, DelegateResult } from './delegate'

export { agent, isAgent } from './agent'
export type { Agent, AnyAgent, AgentConfig, AgentLike, HandoffTarget, InferAgentInput, InferAgentOutput } from './agent'

export { createParallel } from './parallel'
export type { ParallelOptions, ParallelResult, SettledResult } from './parallel'

export { createPipeline } from './pipeline'
export type { PipelineResult, StepName, StepOutput } from './pipeline'

export { createConsensus } from './consensus'
export type { ConsensusOptions, ConsensusResult } from './consensus'
export { ConsensusError } from './consensus'

export { createSwarm, buildTransferTools } from './swarm'
export type { SwarmOptions, SwarmResult, SwarmHandoffContext, SwarmHandoffEvent, SwarmCostInfo } from './swarm'
export { SwarmError } from './swarm'

export { createCompositions } from './create-compositions'

export type { AgentExecutor, AgentResult, ExecuteOptions } from './executor'
