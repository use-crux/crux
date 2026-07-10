/**
 * In-memory fakes for every resolver port.
 *
 * Pass these through `compilePrompt(config, { ports })` and prompt resolution
 * becomes fully observable and deterministic in tests: no `setHooks()`
 * setup, no observability transport, no global cleanup between tests, and a
 * clock you control. Exported from `@use-crux/core` so SDK consumers get the same
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
 * } from '@use-crux/core'
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
import { generateIndex } from '../skill/project-index'
import { createSkillActivationSession, readActiveSkillIds } from '../skill/session'
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
  ResolverPorts,
  ResolveTraceScope,
  SkillSourcePort,
  TokenizerPort,
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
    index: (entries) => generateIndex(entries),
    createActivationSession: ({ skills: entries, input }) =>
      createSkillActivationSession({ skills: entries, initial: { activeSkillIds: readActiveSkillIds(input) } }),
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

// ─────────────────────────────────────────────────────────────────
// Tokenizer
// ─────────────────────────────────────────────────────────────────

/**
 * A deterministic {@link TokenizerPort} for budget and token-attribution tests.
 *
 * Pass any counter; a word counter (`text.trim().split(/\s+/).length`) makes
 * dropped-context and token-total assertions predictable without depending on
 * the production chars/4 estimate. Defaults to word counting.
 */
export function staticTokenizer(count: (text: string) => number = wordCount): TokenizerPort {
  return { count }
}

function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
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

// ─────────────────────────────────────────────────────────────────
// Bundle
// ─────────────────────────────────────────────────────────────────

/** Options for {@link createResolverFakes}. Every field has a deterministic default. */
export interface ResolverFakesOptions {
  /** Starting timestamp for the {@link fixedClock}. Defaults to `1_000`. */
  clockStart?: number
  /** Sanitization policy overrides (auto-escape / security warnings). Both default off. */
  policy?: Partial<ResolvePolicy>
  /** Token estimator. Defaults to a deterministic word counter ({@link staticTokenizer}). */
  tokenizer?: TokenizerPort
  /** Registry skills served by the in-memory skill source. */
  skills?: Record<string, ResolvedRegistrySkill>
}

/**
 * The assembled fake ports plus their typed handles, for boundary assertions.
 *
 * `ports` plugs straight into `compilePrompt(config, { ports })`; the named
 * handles (`observability`, `skills`, `clock`, …) are the same instances inside
 * `ports`, exposed so a test can advance the clock, register a registry skill,
 * or read recorded scopes without re-deriving them from `ports`.
 */
export interface ResolverFakes {
  /** A complete, deterministic {@link ResolverPorts} for `compilePrompt`. */
  ports: ResolverPorts
  observability: RecordingObservability
  skills: InMemorySkillSource
  cache: InMemoryContextCache
  clock: FixedClock
  tokenizer: TokenizerPort
  policy: () => ResolvePolicy
  diagnostics: CollectingDiagnostics
  instrumentation: RecordingInstrumentation
}

/**
 * Build a complete set of in-memory resolver ports in one call.
 *
 * This is the canonical test seam for the `compilePrompt()` boundary: every
 * ambient dependency (observability, skill source, context cache, clock,
 * tokenizer, policy, diagnostics, instrumentation) is a deterministic fake with
 * no `setHooks()` setup and no global cleanup between tests. The clock and
 * the cache share one instance, so TTL expiry follows the clock you advance.
 *
 * @example
 * ```ts
 * const fakes = createResolverFakes()
 * const compiled = compilePrompt(config, { ports: fakes.ports })
 *
 * const resolution = await compiled.resolve({ input: { topic: 'billing' } })
 * expect(resolution.args.tools).toHaveProperty('LoadSkill')
 * expect(resolution.inspect().excludedContexts).toEqual([])
 * expect(fakes.diagnostics.warnings).toHaveLength(0)
 * ```
 */
export function createResolverFakes(options: ResolverFakesOptions = {}): ResolverFakes {
  const observability = recordingObservability()
  const skills = inMemorySkillSource(options.skills)
  const clock = fixedClock(options.clockStart ?? 1_000)
  const cache = inMemoryContextCache(clock)
  const tokenizer = options.tokenizer ?? staticTokenizer()
  const diagnostics = collectingDiagnostics()
  const instrumentation = recordingInstrumentation()
  const policy = staticPolicy(options.policy)

  return {
    observability,
    skills,
    cache,
    clock,
    tokenizer,
    policy,
    diagnostics,
    instrumentation,
    ports: { observability, skills, cache, clock, tokenizer, policy, diagnostics, instrumentation },
  }
}
