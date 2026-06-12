/**
 * Resolver ports — the prompt pipeline's only doors to the outside world.
 *
 * Prompt resolution needs seven ambient capabilities: tracing, skill registry
 * access, the context resolver cache, a clock, sanitization policy, warning
 * output, and instrumentation hooks. Each is expressed as a small interface
 * (a *port*) so the pipeline can run against production adapters in apps and
 * in-memory fakes in tests — no `setRuntime()` setup, no global cleanup, and
 * a deterministic clock when you want one.
 *
 * `createPromptResolver()` (exported from `../resolve`) accepts a partial
 * {@link ResolverPorts}; anything you omit falls back to the runtime adapters
 * in this module, which wrap the same globals the pipeline always used —
 * behavior with default ports is identical to the pre-port pipeline.
 *
 * Adapter reads are deliberately lazy (per event, not per resolver): calling
 * `setRuntime()` or `configureObservability()` mid-process takes effect on
 * the very next prompt resolution, exactly as before.
 *
 * Contributor-internal I/O (memory stores, retriever indexes, blackboard
 * stores) intentionally has **no port here** — those factories already take
 * their dependencies explicitly (`memory({ store })`, `retriever({ store })`),
 * and that is the right seam for them.
 *
 * In-memory fakes for every port live in `./fakes.ts` and are exported from
 * `@crux/core`.
 *
 * @module
 */

import { observe } from '../observability'
import type {
  CruxArtifactId,
  CruxArtifactKind,
  CruxPrimitiveFamily,
  CruxPrimitiveName,
} from '../observability/contract'
import { getRuntime } from '../runtime'
import { isAutoEscapeEnabled, isSecurityWarningsEnabled } from '../configure'
import { resolveRegistrySkill } from '../skill/registry'
import { getLatestSkillState, registerSkillState } from '../skill/state'
import type { SkillActivationState } from '../skill/tools'
import type { SkillMeta, SkillReference } from '../skill/types'
import type { ResolvedSystemContent } from './contract'

/** A tracing scope for one unit of resolution work (predicate check, context resolve, the whole prompt). */
export interface ResolveTraceScope {
  name: string
  family: CruxPrimitiveFamily
  primitive: CruxPrimitiveName
  attributes?: Record<string, unknown>
}

/** An artifact record emitted during resolution (contribution, budget, input previews). */
export interface ResolveArtifact {
  kind: CruxArtifactKind
  contentType: string
  encoding: 'json' | 'text' | 'bytes' | 'reference'
  sizeBytes?: number
  preview?: unknown
  attributes?: Record<string, unknown>
}

/**
 * How the pipeline reports what happened.
 *
 * The pipeline emits *facts*; all graph choreography — span lifecycle,
 * artifact ids, wiring `produced` edges from the active span to each
 * artifact — belongs to the adapter behind this port. The default adapter
 * delegates to the global `observe` runtime; the recording fake captures
 * scopes and artifacts as plain arrays.
 */
export interface ObservabilityPort {
  /** Run `fn` inside a traced scope (span). Nested scopes nest in the trace. */
  scope<T>(scope: ResolveTraceScope, fn: () => T | Promise<T>): Promise<T>
  /**
   * Emit an artifact, returning its id when the runtime produced one.
   *
   * @param edgeAttributes - Attributes for the `produced` edge from the
   * currently active span to this artifact, when both exist.
   */
  artifact(record: ResolveArtifact, edgeAttributes?: Record<string, unknown>): CruxArtifactId | undefined
}

/** A registry skill resolved to its full content. */
export interface ResolvedRegistrySkill {
  instructions: string
  references: readonly SkillReference[]
  meta: SkillMeta
}

/**
 * Where skills come from and where activation state lives.
 *
 * Covers the two skill-related ambient dependencies of resolution: fetching
 * lazy registry skills (the only network I/O in the pipeline) and the
 * process-wide activation state used to re-inject previously loaded skills.
 */
export interface SkillSourcePort {
  /** Fetch a registry skill's full content. Rejections degrade to the placeholder skill with a diagnostic warning. */
  resolveRegistrySkill(id: string): Promise<ResolvedRegistrySkill>
  /** Most recently registered activation state, if any (same-process skill activation carry-over). */
  latestActivationState(): SkillActivationState | undefined
  /** Register the activation state created for this resolution; returns its registry id. */
  registerActivationState(state: SkillActivationState): string
}

/** A context-cache lookup result: the cached content plus its age, for instrumentation. */
export interface ContextCacheHit {
  content: ResolvedSystemContent
  ageMs: number
}

/**
 * The resolver-output cache for contexts configured with `cache: { ttl }`.
 *
 * Keys are derived as `cache:ctx:{contextId}:{inputHash}` by the pipeline;
 * the port only stores and expires. The default adapter is the module-level
 * map that has always backed this cache; tests can substitute a fresh
 * per-test map or a null cache.
 */
export interface ContextCachePort {
  /** Return non-expired content for `key`, or `null`. Expired entries are evicted on read. */
  get(key: string): ContextCacheHit | null
  /** Store `content` under `key` for `ttlMs` milliseconds. */
  set(key: string, content: ResolvedSystemContent, ttlMs: number): void
}

/** Time source for cache ages and resolution timings. Substitute a fixed clock for deterministic tests. */
export interface ClockPort {
  now(): number
}

/** Sanitization policy snapshot, read lazily once per resolution step. */
export interface ResolvePolicy {
  /** Escape XML-significant characters in string inputs (except declared `rawFields`). */
  autoEscape: boolean
  /** Detect and warn about suspicious patterns in string inputs (dev mode). */
  securityWarnings: boolean
}

/**
 * Non-fatal problem reporting. The pipeline warns (it never logs info) for
 * degradations like a failed lazy-skill fetch or a suspicious input pattern.
 * Defaults to `console.warn`; the collecting fake captures entries instead.
 */
export interface DiagnosticsPort {
  warn(message: string, detail?: unknown): void
}

/** Context-cache instrumentation events, forwarded to `instrumentationHooks` by default. */
export interface InstrumentationPort {
  contextCacheHit(event: { contextId: string; cacheKey: string; ageMs: number }): void
  contextCacheMiss(event: { contextId: string; cacheKey: string; resolutionMs: number }): void
}

/**
 * The full set of ports prompt resolution runs against.
 *
 * Build one with {@link withDefaultResolverPorts} — pass only what you want
 * to substitute:
 *
 * ```ts
 * const ports = withDefaultResolverPorts({
 *   clock: fixedClock(1_000),
 *   diagnostics: collectingDiagnostics(),
 * })
 * ```
 */
export interface ResolverPorts {
  observability: ObservabilityPort
  skills: SkillSourcePort
  cache: ContextCachePort
  clock: ClockPort
  /** Read the current policy. Called lazily so `configure()` changes apply immediately. */
  policy: () => ResolvePolicy
  diagnostics: DiagnosticsPort
  instrumentation: InstrumentationPort
}

// ─────────────────────────────────────────────────────────────────
// Default adapters (wrap the pre-existing globals)
// ─────────────────────────────────────────────────────────────────

const runtimeObservability: ObservabilityPort = {
  scope(scope, fn) {
    return observe.span(scope, async () => fn())
  },
  artifact(record, edgeAttributes) {
    const activeSpanId = observe.captureContext()?.currentSpanId
    const artifactId = observe.artifact(record)
    if (activeSpanId && artifactId) {
      observe.edge({
        edgeType: 'produced',
        from: { kind: 'span', id: activeSpanId },
        to: { kind: 'artifact', id: artifactId },
        ...(edgeAttributes ? { attributes: edgeAttributes } : {}),
      })
    }
    return artifactId
  },
}

const runtimeSkillSource: SkillSourcePort = {
  resolveRegistrySkill: (id) => resolveRegistrySkill(id),
  latestActivationState: () => getLatestSkillState(),
  registerActivationState: (state) => registerSkillState(state),
}

/** Internal cache entry for a resolved context system contribution. */
interface ContextCacheEntry {
  content: ResolvedSystemContent
  expiresAt: number
  storedAtMs: number
}

/**
 * Module-level cache for context resolver outputs, shared by every resolver
 * that uses default ports (matching the pre-port behavior where this map was
 * a `resolve.ts` module singleton).
 */
const contextResolverCache = new Map<string, ContextCacheEntry>()

const moduleContextCache: ContextCachePort = {
  get(key) {
    const entry = contextResolverCache.get(key)
    if (!entry) return null
    const now = Date.now()
    if (now >= entry.expiresAt) {
      contextResolverCache.delete(key)
      return null
    }
    return { content: entry.content, ageMs: now - entry.storedAtMs }
  },
  set(key, content, ttlMs) {
    const now = Date.now()
    contextResolverCache.set(key, { content, expiresAt: now + ttlMs, storedAtMs: now })
  },
}

const systemClock: ClockPort = { now: () => Date.now() }

const consoleDiagnostics: DiagnosticsPort = {
  warn(message, detail) {
    if (detail === undefined) console.warn(message)
    else console.warn(message, detail)
  },
}

const runtimeInstrumentation: InstrumentationPort = {
  contextCacheHit(event) {
    getRuntime().instrumentationHooks?.onContextCacheHit?.(event)
  },
  contextCacheMiss(event) {
    getRuntime().instrumentationHooks?.onContextCacheMiss?.(event)
  },
}

function configuredPolicy(): ResolvePolicy {
  return {
    autoEscape: isAutoEscapeEnabled(),
    securityWarnings: isSecurityWarningsEnabled(),
  }
}

/**
 * Fill missing ports with the production runtime adapters.
 *
 * With no argument this returns the exact ambient behavior the pipeline has
 * always had (global `observe`, skill registry, module cache, `Date.now`,
 * `configure()` policy, `console.warn`, `instrumentationHooks`). Pass a
 * partial object to substitute individual ports — everything else stays real.
 */
export function withDefaultResolverPorts(overrides?: Partial<ResolverPorts>): ResolverPorts {
  return {
    observability: overrides?.observability ?? runtimeObservability,
    skills: overrides?.skills ?? runtimeSkillSource,
    cache: overrides?.cache ?? moduleContextCache,
    clock: overrides?.clock ?? systemClock,
    policy: overrides?.policy ?? configuredPolicy,
    diagnostics: overrides?.diagnostics ?? consoleDiagnostics,
    instrumentation: overrides?.instrumentation ?? runtimeInstrumentation,
  }
}
