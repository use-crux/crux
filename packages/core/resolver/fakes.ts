/**
 * In-memory fakes for every resolver port.
 *
 * Pass these through `compilePrompt(config, { ports })` and prompt resolution
 * becomes fully observable and deterministic in tests: no `setRuntime()`
 * setup, no observability transport, no global cleanup between tests, and a
 * clock you control. Exported from `@crux/core` so SDK consumers get the same
 * seams the core test suite uses.
 *
 * @example
 * ```ts
 * import {
 *   compilePrompt,
 *   recordingObservability,
 *   inMemorySkillSource,
 *   inMemoryContextCache,
 *   fixedClock,
 *   collectingDiagnostics,
 * } from '@crux/core'
 *
 * const observability = recordingObservability()
 * const diagnostics = collectingDiagnostics()
 * const clock = fixedClock(1_000)
 * const compiled = compilePrompt(config, {
 *   ports: {
 *     observability,
 *     diagnostics,
 *     clock,
 *     cache: inMemoryContextCache(clock),
 *     skills: inMemorySkillSource(),
 *   },
 * })
 *
 * const pass = await compiled.resolve({ input })
 * expect(pass.inspect().excludedContexts).toEqual([])
 * expect(diagnostics.warnings).toHaveLength(0)
 * ```
 *
 * @module
 */

import { createCruxArtifactId } from '../observability'
import type { CruxArtifactId, CruxContextContributionPreview } from '../observability/contract'
import type { ResolvedSystemContent } from './contract'
import type {
  ClockPort,
  ContextCacheHit,
  ContextCachePort,
  DiagnosticsPort,
  InstrumentationPort,
  ObservabilityPort,
  ResolveArtifact,
  ResolvedRegistrySkill,
  ResolvePolicy,
  ResolveTraceScope,
  SkillSourcePort,
} from './ports'

// ─────────────────────────────────────────────────────────────────
// Observability
// ─────────────────────────────────────────────────────────────────

/** One artifact captured by {@link recordingObservability}. */
export interface RecordedArtifact {
  artifactId: CruxArtifactId
  record: ResolveArtifact
  edgeAttributes?: Record<string, unknown>
  /** Scope stack at emission time (innermost last) — artifact↔span attribution without a graph. */
  scopePath: readonly string[]
}

/** An {@link ObservabilityPort} that records scopes and artifacts as plain arrays. */
export interface RecordingObservability extends ObservabilityPort {
  /** Every scope entered, in execution order (depth-first). */
  scopes: Array<ResolveTraceScope & { path: readonly string[] }>
  /** Every artifact emitted, in execution order. */
  artifacts: RecordedArtifact[]
  /** Convenience: `context.contribution` previews, optionally filtered by state. */
  contributionPreviews(state?: string): CruxContextContributionPreview[]
}

/**
 * Record resolution telemetry without an observability runtime.
 *
 * Scopes still execute their function (and nest), artifacts get real ids;
 * nothing is delivered anywhere. Assert on `scopes`, `artifacts`, or the
 * `contributionPreviews()` shorthand.
 */
export function recordingObservability(): RecordingObservability {
  const scopeStack: string[] = []
  const scopes: RecordingObservability['scopes'] = []
  const artifacts: RecordedArtifact[] = []
  return {
    scopes,
    artifacts,
    async scope(scope, fn) {
      scopes.push({ ...scope, path: [...scopeStack, scope.name] })
      scopeStack.push(scope.name)
      try {
        return await fn()
      } finally {
        scopeStack.pop()
      }
    },
    artifact(record, edgeAttributes) {
      const artifactId = createCruxArtifactId()
      artifacts.push({
        artifactId,
        record,
        ...(edgeAttributes ? { edgeAttributes } : {}),
        scopePath: [...scopeStack],
      })
      return artifactId
    },
    contributionPreviews(state) {
      return artifacts
        .filter((a) => a.record.kind === 'context.contribution')
        .map((a) => a.record.preview as CruxContextContributionPreview)
        .filter((p) => state === undefined || p.state === state)
    },
  }
}

// ─────────────────────────────────────────────────────────────────
// Skills
// ─────────────────────────────────────────────────────────────────

/** A {@link SkillSourcePort} backed by an in-memory registry record. */
export interface InMemorySkillSource extends SkillSourcePort {
  /** Add or replace a registry skill. */
  register(id: string, skill: ResolvedRegistrySkill): void
}

/**
 * Serve registry skills from a record instead of the network.
 *
 * Unknown ids reject (like a failed fetch), which is exactly how you test
 * the degraded placeholder-plus-warning path.
 */
export function inMemorySkillSource(skills: Record<string, ResolvedRegistrySkill> = {}): InMemorySkillSource {
  const registry = new Map(Object.entries(skills))
  return {
    register(id, skill) {
      registry.set(id, skill)
    },
    async resolveRegistrySkill(id) {
      const skill = registry.get(id)
      if (!skill) throw new Error(`Skill "${id}" not found in in-memory registry`)
      return skill
    },
  }
}

// ─────────────────────────────────────────────────────────────────
// Clock & cache
// ─────────────────────────────────────────────────────────────────

/** A {@link ClockPort} you can move by hand. */
export interface FixedClock extends ClockPort {
  /** Move the clock forward by `ms`. */
  advance(ms: number): void
  /** Jump the clock to an absolute timestamp. */
  set(ms: number): void
}

/**
 * A clock that only moves when you tell it to — pin cache ages and
 * resolution timings exactly.
 */
export function fixedClock(start = 0): FixedClock {
  let now = start
  return {
    now: () => now,
    advance(ms) {
      now += ms
    },
    set(ms) {
      now = ms
    },
  }
}

/** A {@link ContextCachePort} with inspectable entries, expired by the provided clock. */
export interface InMemoryContextCache extends ContextCachePort {
  entries: Map<string, { content: ResolvedSystemContent; expiresAt: number; storedAtMs: number }>
}

/**
 * A fresh, per-test context cache. Pass the same {@link fixedClock} you give
 * the resolver so TTL expiry follows test time; defaults to the real clock.
 */
export function inMemoryContextCache(clock: ClockPort = { now: () => Date.now() }): InMemoryContextCache {
  const entries: InMemoryContextCache['entries'] = new Map()
  return {
    entries,
    get(key): ContextCacheHit | null {
      const entry = entries.get(key)
      if (!entry) return null
      const now = clock.now()
      if (now >= entry.expiresAt) {
        entries.delete(key)
        return null
      }
      return { content: entry.content, ageMs: now - entry.storedAtMs }
    },
    set(key, content, ttlMs) {
      const now = clock.now()
      entries.set(key, { content, expiresAt: now + ttlMs, storedAtMs: now })
    },
  }
}

// ─────────────────────────────────────────────────────────────────
// Diagnostics, policy, instrumentation
// ─────────────────────────────────────────────────────────────────

/** A {@link DiagnosticsPort} that collects warnings instead of printing them. */
export interface CollectingDiagnostics extends DiagnosticsPort {
  warnings: Array<{ message: string; detail?: unknown }>
}

/** Capture pipeline warnings (failed skill fetches, security warnings) for assertion. */
export function collectingDiagnostics(): CollectingDiagnostics {
  const warnings: CollectingDiagnostics['warnings'] = []
  return {
    warnings,
    warn(message, detail) {
      warnings.push(detail === undefined ? { message } : { message, detail })
    },
  }
}

/** A fixed policy thunk. Defaults match production defaults (auto-escape off, warnings off). */
export function staticPolicy(policy?: Partial<ResolvePolicy>): () => ResolvePolicy {
  const resolved: ResolvePolicy = {
    autoEscape: policy?.autoEscape ?? false,
    securityWarnings: policy?.securityWarnings ?? false,
  }
  return () => resolved
}

/** An {@link InstrumentationPort} that collects cache events for assertion. */
export interface RecordingInstrumentation extends InstrumentationPort {
  events: Array<
    | { kind: 'hit'; contextId: string; cacheKey: string; ageMs: number }
    | { kind: 'miss'; contextId: string; cacheKey: string; resolutionMs: number }
  >
}

/** Capture context-cache hit/miss events without a runtime hook installation. */
export function recordingInstrumentation(): RecordingInstrumentation {
  const events: RecordingInstrumentation['events'] = []
  return {
    events,
    contextCacheHit(event) {
      events.push({ kind: 'hit', ...event })
    },
    contextCacheMiss(event) {
      events.push({ kind: 'miss', ...event })
    },
  }
}
