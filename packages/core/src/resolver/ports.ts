/**
 * Resolver ports — the prompt pipeline's only doors to the outside world.
 *
 * Prompt resolution needs seven ambient capabilities: tracing, skill registry
 * access, the context resolver cache, a clock, sanitization policy, warning
 * output, and instrumentation hooks. Each is expressed as a small interface
 * (a *port*) so the pipeline can run against production adapters in apps and
 * in-memory fakes in tests — no `setHooks()` setup, no global cleanup, and
 * a deterministic clock when you want one.
 *
 * `compilePrompt(config, { ports })` accepts a partial {@link ResolverPorts};
 * anything you omit falls back to the runtime adapters in this module, which
 * wrap the same globals the pipeline always used — behavior with default
 * ports is identical to the ambient prompt pipeline.
 *
 * Adapter reads are deliberately lazy (per event, not per resolver): calling
 * `setHooks()` or `configureObservability()` mid-process takes effect on
 * the very next prompt resolution, exactly as before.
 *
 * Contributor-internal I/O (memory stores, retriever indexes, blackboard
 * stores) intentionally has **no port here** — those factories already take
 * their dependencies explicitly (`memory({ store })`, `retriever({ store })`),
 * and that is the right seam for them.
 *
 * The production adapters that back these contracts live in `./default-ports`
 * (wired in by {@link withDefaultResolverPorts}); in-memory fakes for every
 * port live in `./fakes`, exported from `@use-crux/core`.
 *
 * @module
 */

import type {
  CruxArtifactId,
  CruxArtifactKind,
  CruxPrimitiveFamily,
  CruxPrimitiveName,
  DefinitionRef,
} from "../observability/contract";
import type { SkillActivationSession } from "../skill/session";
import type { SkillEntry } from "../prompt/context-types";
import type { SkillMeta, SkillReference } from "../skill/types";
import type { ResolvedSystemContent } from "./contract";

export { withDefaultResolverPorts } from "./default-ports";

/** A tracing scope for one unit of resolution work (predicate check, context resolve, the whole prompt). */
export interface ResolveTraceScope {
  name: string;
  family: CruxPrimitiveFamily;
  primitive: CruxPrimitiveName;
  attributes?: Record<string, unknown>;
  /**
   * Project Index definitions this scope resolved. Forwarded verbatim onto the
   * `span:start` record so the runtime→index join can attach evidence; the
   * default adapter passes them to `observe.span`. Callers own canonical id
   * construction (see `../observability/definition-ref`).
   */
  definitionRefs?: DefinitionRef[];
}

/** An artifact record emitted during resolution (contribution, budget, input previews). */
export interface ResolveArtifact {
  kind: CruxArtifactKind;
  contentType: string;
  encoding: "json" | "text" | "bytes" | "reference";
  sizeBytes?: number;
  preview?: unknown;
  attributes?: Record<string, unknown>;
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
  scope<T>(scope: ResolveTraceScope, fn: () => T | Promise<T>): Promise<T>;
  /**
   * Emit an artifact, returning its id when the runtime produced one.
   *
   * @param edgeAttributes - Attributes for the `produced` edge from the
   * currently active span to this artifact, when both exist.
   */
  artifact(
    record: ResolveArtifact,
    edgeAttributes?: Record<string, unknown>,
  ): CruxArtifactId | undefined;
}

/** A registry skill resolved to its full content. */
export interface ResolvedRegistrySkill {
  instructions: string;
  references: readonly SkillReference[];
  meta: SkillMeta;
}

/**
 * The pipeline's whole skill surface: registry fetch, index generation, and
 * activation-session creation.
 *
 * These three are grouped because they are the skill pipeline's only ambient
 * dependencies — the cross-entry skill collector and the resolve-mode loader
 * tooling reach the skill domain exclusively through this port, so tests can
 * substitute a custom index, observe session creation, or fail a registry
 * fetch without touching the skill module internals.
 *
 * Registry fetch is the only skill-related network I/O; index and session
 * creation are pure/local. Skill activation state is carried explicitly by
 * `_crux_activeSkills` in resolve input.
 */
export interface SkillSourcePort {
  /** Fetch a registry skill's full content. Rejections degrade to the placeholder skill with a diagnostic warning. */
  resolveRegistrySkill(id: string): Promise<ResolvedRegistrySkill>;
  /** Generate the auto-index text that leads a prompt's skill contributions. */
  index(skills: readonly SkillEntry[]): string;
  /** Open an activation session over `skills`, seeded from the input's active-skill ids. */
  createActivationSession(args: {
    skills: readonly SkillEntry[];
    input: unknown;
  }): SkillActivationSession;
}

/** A context-cache lookup result: the cached content plus its age, for instrumentation. */
export interface ContextCacheHit {
  content: ResolvedSystemContent;
  ageMs: number;
}

/**
 * The resolver-output cache for contexts configured with `memo: { ttl }`.
 *
 * Keys are derived as `cache:ctx:{contextId}:{inputHash}` by the pipeline;
 * the port only stores and expires. The default adapter is the module-level
 * map that has always backed this cache; tests can substitute a fresh
 * per-test map or a null cache.
 */
export interface ContextCachePort {
  /** Return non-expired content for `key`, or `null`. Expired entries are evicted on read. */
  get(key: string): ContextCacheHit | null;
  /** Store `content` under `key` for `ttlMs` milliseconds. */
  set(key: string, content: ResolvedSystemContent, ttlMs: number): void;
}

/** Time source for cache ages and resolution timings. Substitute a fixed clock for deterministic tests. */
export interface ClockPort {
  now(): number;
}

/**
 * Token estimation for system-budget decisions and inspect token attribution.
 *
 * Every token count the pipeline reports — system parts, prompt text, dropped
 * contexts — flows through this port, so the same composition resolves
 * identically under any estimator. The default adapter wraps the pluggable
 * global `countTokens` (`setTokenizer()` / `configure({ tokenizer })`); tests
 * substitute a deterministic counter (e.g. word count) to pin budget behavior
 * without depending on the production chars/4 estimate.
 */
export interface TokenizerPort {
  /** Estimate the token count of `text`. */
  count(text: string): number;
}

/** Sanitization policy snapshot, read lazily once per resolution step. */
export interface ResolvePolicy {
  /** Escape XML-significant characters in string inputs (except declared `rawFields`). */
  autoEscape: boolean;
  /** Detect and warn about suspicious patterns in string inputs (dev mode). */
  securityWarnings: boolean;
}

/**
 * Non-fatal problem reporting. The pipeline warns (it never logs info) for
 * degradations like a failed lazy-skill fetch or a suspicious input pattern.
 * Defaults to `console.warn`; the collecting fake captures entries instead.
 */
export interface DiagnosticsPort {
  warn(message: string, detail?: unknown): void;
}

/** Context-cache instrumentation events. */
export interface InstrumentationPort {
  contextCacheHit(event: {
    contextId: string;
    cacheKey: string;
    ageMs: number;
  }): void;
  contextCacheMiss(event: {
    contextId: string;
    cacheKey: string;
    resolutionMs: number;
  }): void;
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
  observability: ObservabilityPort;
  skills: SkillSourcePort;
  cache: ContextCachePort;
  clock: ClockPort;
  tokenizer: TokenizerPort;
  /** Read the current policy. Called lazily so `configure()` changes apply immediately. */
  policy: () => ResolvePolicy;
  diagnostics: DiagnosticsPort;
  instrumentation: InstrumentationPort;
}

/**
 * Create the inspect-mode observability decorator.
 *
 * The resolver still runs the same ordered pass in inspect mode, including
 * gates, context resolution, budget work, and memo-cache reads/writes. This
 * port only suppresses emission: scopes execute their body and artifacts are
 * ignored, so inspect stays deterministic without producing telemetry.
 *
 * @internal
 */
export function quietObservability(): ObservabilityPort {
  return {
    async scope(_scope, fn) {
      return await fn();
    },
    artifact() {
      return undefined;
    },
  };
}

/**
 * Create the inspect-mode instrumentation decorator.
 *
 * Inspect intentionally uses the normal memo-cache path; hit/miss hooks are
 * quieted here so cache warming does not emit instrumentation events.
 *
 * @internal
 */
export function quietInstrumentation(): InstrumentationPort {
  return {
    contextCacheHit() {},
    contextCacheMiss() {},
  };
}

/**
 * Create the inspect-mode diagnostics decorator.
 *
 * Inspect is a structural read of the resolution result, not an emitting
 * operation. Definition-time diagnostics still fire during compilation; this
 * quiet port suppresses warnings produced by the resolve/inspect pass itself.
 *
 * @internal
 */
export function quietDiagnostics(): DiagnosticsPort {
  return {
    warn() {},
  };
}
