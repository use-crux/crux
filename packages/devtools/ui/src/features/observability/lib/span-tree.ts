import type { CompositionType, RuntimeFlowRun, RuntimeFlowStepData, SpanPrimitive, Trace } from '@/types'

// Shared tree DTO used by dumb tree/detail components. Backend canonical
// read models are mapped into this shape in `useObservabilityGraph`; this
// module intentionally does not build or infer execution hierarchy.
export interface SpanNode {
  id: string
  seq?: number
  kind: 'session' | 'flow' | 'step' | 'trace' | 'handoff' | 'composition'
  primitive?: SpanPrimitive | string
  compositionType?: CompositionType
  label: string
  status: 'success' | 'error' | 'running' | 'stale'
  durationMs?: number
  startedAt: number
  cost?: number
  tokens?: number
  model?: string
  children: SpanNode[]
  depth: number
  trace?: Trace
  flowRun?: RuntimeFlowRun
  stepData?: RuntimeFlowStepData
  composition?: {
    kind: 'parallel' | 'pipeline' | 'consensus' | 'swarm'
    agentCount: number
    agreement?: number
    handoffPath?: string[]
    handoffCount?: number
    finalAgentId?: string
  }
  delegate?: {
    delegateId: string
    handoffId?: string
    durationMs?: number
    inputSize?: number
    outputSize?: number
    fromAgent?: string
    toAgent?: string
    input?: unknown
    output?: unknown
  }
}
