import type { RuntimeStoreAdapter } from '@use-crux/core/runtime'
import type { EvalHostAdmissionPort } from '@use-crux/core/runtime/internal/eval-host'
import type { ConvexCtxPort } from '../store'
import type { ConvexRuntimeResultComponent } from './results'

/** Component refs needed by the Runtime Engine store adapter. */
export interface ConvexRuntimeComponent {
  readonly runtime: {
    readonly state: Record<string, unknown>
    readonly events: Record<string, unknown>
    readonly waiters: Record<string, unknown>
    readonly timers: Record<string, unknown>
    readonly outbox: Record<string, unknown>
    readonly leases: Record<string, unknown>
    readonly deferred?: Record<string, unknown>
    readonly results?: ConvexRuntimeResultComponent
    readonly sessions?: { readonly run?: unknown }
    readonly evalHost?: { readonly admit?: unknown }
    readonly composites?: { readonly run?: unknown }
  }
}

/** Configuration for the component-backed Runtime store. */
export interface ConvexRuntimeStoreOptions<TCtx extends ConvexCtxPort = ConvexCtxPort> {
  /** Current Convex mutation ctx. */
  readonly ctx: TCtx
  /** Crux Convex component refs, normally `components.crux`. */
  readonly component: ConvexRuntimeComponent
  /** Clock used for deterministic tests. */
  readonly now?: () => Date
}

/** Convex Runtime store backed by the component, with optional Eval capabilities. */
export interface ConvexRuntimeStore extends RuntimeStoreAdapter {
  readonly results?: RuntimeStoreAdapter['results']
  readonly evalHost?: EvalHostAdmissionPort
}
