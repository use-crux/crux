import { observe } from '@use-crux/core/observability'

export interface ConvexSwarmCompositionStart {
  readonly compositionId: string
  readonly kind: 'swarm'
  readonly agentIds: readonly string[]
  readonly startAgent: string
  readonly maxHandoffs: number
}

export interface ConvexSwarmEndState {
  readonly status: 'running' | 'completed' | 'error'
  readonly handoffPath: readonly string[]
  readonly handoffCount: number
  readonly currentAgentId: string
}

/** Attach durable Convex swarm start metadata to the active composition span. */
export function observeConvexSwarmStart(event: ConvexSwarmCompositionStart): void {
  observe.event({
    name: 'composition.start',
    attributes: {
      compositionId: event.compositionId,
      kind: event.kind,
      agentIds: event.agentIds,
      startAgent: event.startAgent,
      maxHandoffs: event.maxHandoffs,
    },
  })
}

/** Attach a single Convex swarm agent turn to the active composition span. */
export function observeConvexSwarmAgent(
  compositionId: string,
  agentId: string,
  index: number,
  durationMs: number,
  handoffFrom?: string,
): void {
  observe.event({
    name: 'composition.agent',
    attributes: {
      compositionId,
      agentId,
      index,
      status: 'success',
      durationMs,
      ...(handoffFrom ? { handoffFrom } : {}),
      ...(index > 0 ? { hopNumber: index } : {}),
    },
  })
}

/** Attach final Convex swarm state to the active composition span. */
export function observeConvexSwarmEnd(compositionId: string, state: ConvexSwarmEndState, durationMs: number): void {
  observe.event({
    name: 'composition.end',
    attributes: {
      compositionId,
      kind: 'swarm',
      status: state.status === 'error' ? 'error' : 'success',
      durationMs,
      agentCount: state.handoffPath.length,
      handoffPath: state.handoffPath,
      handoffCount: state.handoffCount,
      finalAgentId: state.currentAgentId,
    },
  })
}
