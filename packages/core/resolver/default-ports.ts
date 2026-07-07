/**
 * Production adapters for the resolver ports.
 *
 * Each adapter wraps the ambient global the prompt pipeline has always used —
 * `observe`, the skill registry/index/session factories, the module-level
 * context cache, `Date.now`, `countTokens`, `configure()` policy flags, and
 * `console.warn` (context-cache instrumentation is a no-op by default; it is
 * delivered through the observability graph). Reads are deliberately lazy (per
 * event, not captured at bind time), so `setHooks()` /
 * `configureObservability()` / `setTokenizer()` keep taking effect on the very
 * next resolution.
 *
 * `withDefaultResolverPorts()` fills any port a caller omits with these
 * adapters; the port *contracts* live in `./ports`, the in-memory test fakes in
 * `./fakes`.
 *
 * @module
 */

import { observe } from '../observability'
import { isAutoEscapeEnabled, isSecurityWarningsEnabled } from '../runtime/configure'
import { resolveRegistrySkill } from '../skill/registry'
import { generateIndex } from '../skill/project-index'
import { createSkillActivationSession, readActiveSkillIds } from '../skill/session'
import { countTokens } from '../shared/tokenizer'
import type { ResolvedSystemContent } from './contract'
import type {
  ClockPort,
  ContextCachePort,
  DiagnosticsPort,
  InstrumentationPort,
  ObservabilityPort,
  ResolvePolicy,
  ResolverPorts,
  SkillSourcePort,
  TokenizerPort,
} from './ports'

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
  index: (skills) => generateIndex(skills),
  createActivationSession: ({ skills, input }) =>
    createSkillActivationSession({ skills, initial: { activeSkillIds: readActiveSkillIds(input) } }),
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

const runtimeTokenizer: TokenizerPort = { count: (text) => countTokens(text) }

const consoleDiagnostics: DiagnosticsPort = {
  warn(message, detail) {
    if (detail === undefined) console.warn(message)
    else console.warn(message, detail)
  },
}

// Context-cache instrumentation is delivered through the observability graph on
// the current runtime; the default adapter is a no-op (the recording fake in
// `./fakes` captures events for tests).
const runtimeInstrumentation: InstrumentationPort = {
  contextCacheHit() {},
  contextCacheMiss() {},
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
 * `countTokens`, `configure()` policy, `console.warn`, `instrumentationHooks`).
 * Pass a partial object to substitute individual ports — everything else stays
 * real.
 */
export function withDefaultResolverPorts(overrides?: Partial<ResolverPorts>): ResolverPorts {
  return {
    observability: overrides?.observability ?? runtimeObservability,
    skills: overrides?.skills ?? runtimeSkillSource,
    cache: overrides?.cache ?? moduleContextCache,
    clock: overrides?.clock ?? systemClock,
    tokenizer: overrides?.tokenizer ?? runtimeTokenizer,
    policy: overrides?.policy ?? configuredPolicy,
    diagnostics: overrides?.diagnostics ?? consoleDiagnostics,
    instrumentation: overrides?.instrumentation ?? runtimeInstrumentation,
  }
}
