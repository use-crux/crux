/**
 * DefinitionRef construction for runtime evidence.
 *
 * Runtime records join back to Project Index definitions through a
 * {@link DefinitionRef}. This module owns the two pieces that emitters must get
 * exactly right: the canonical definition id (which must match the indexer's
 * `ProjectDefinition.ID`) and a source sanitizer that guarantees no absolute
 * host path or `..` traversal can leak onto the wire.
 *
 * @module
 */

import { sha256Hex } from '../content/sha256'
import type { ProjectDefinitionKind } from '../project-index'
import type { DefinitionRef, SanitizedSourceRef } from './contract'

/** Composition modes that own a canonical `composition.<kind>` definition. */
export type CompositionRefKind = 'parallel' | 'pipeline' | 'consensus' | 'swarm'

/**
 * Source shape available on compiled definitions and runtime call sites. Mirrors
 * {@link import('./contract').CruxSourceLocation} but tolerates the partial/absent
 * values a runtime emitter may hold, so callers can hand over whatever they have.
 */
export interface DefinitionSourceInput {
  file?: string
  line?: number
  column?: number
  /** Present on stack-derived call sites; intentionally never emitted. */
  function?: string
}

/** Options controlling how a source location is proven repo-relative. */
export interface SanitizeDefinitionSourceOptions {
  /** Absolute project root used to relativize absolute source paths. */
  projectRoot?: string
}

/**
 * Port of the indexer's `safe_id` normalization (see
 * `crates/primitives/src/definition.rs` and `packages/indexer/src/indexer/definitions.ts`).
 * Keeps `[A-Za-z0-9_.:-]`, collapses any other run into a single `-`, and trims
 * leading/trailing `-`. The canonical definition id emitted here must equal the
 * indexer's, or the runtime→index join silently breaks.
 */
function safeDefinitionId(value: string): string {
  // `id` is a required non-empty string in public types, but tolerate loose
  // internal callers rather than throwing on the observability path.
  const raw = typeof value === 'string' ? value : String(value)
  let output = ''
  let pendingDash = false
  for (const character of raw.trim()) {
    if (/[A-Za-z0-9_.:-]/.test(character)) {
      if (pendingDash && !output.endsWith('-')) output += '-'
      output += character
      pendingDash = false
    } else {
      pendingDash = true
    }
  }
  const trimmed = output.replace(/^-+|-+$/g, '')
  // Empty-after-sanitize (all-punctuation/unicode/whitespace authored ids): mirror
  // the indexer's fingerprint fallback exactly — sha256(JSON.stringify(value))
  // truncated to 16 hex chars over the *original untrimmed* value — so the
  // runtime→index join stays byte-identical instead of fabricating a raw id.
  return trimmed || fingerprintDefinitionId(raw)
}

/**
 * Edge-runtime-safe port of the indexer's `fingerprint` (see
 * `packages/indexer/src/indexer/definitions.ts` and the Rust `fingerprint_json`
 * in `crates/primitives/src/definition.rs`). Uses the pure-TS SHA-256 and
 * `JSON.stringify`, whose string escaping matches `serde_json::to_string`, so no
 * `node:crypto` dependency is introduced.
 */
function fingerprintDefinitionId(value: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  return sha256Hex(bytes).slice(0, 16)
}

function normalizeSeparators(path: string): string {
  return path.replace(/\\/g, '/')
}

function isAbsolute(path: string): boolean {
  // POSIX root, Windows drive (C:/), or UNC (//server) — all after separator
  // normalization to forward slashes.
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path)
}

function hasTraversal(path: string): boolean {
  return path.split('/').some((segment) => segment === '..')
}

/**
 * Convert a compiled/runtime source location into a repo-relative
 * {@link SanitizedSourceRef}, or `undefined` when a safe repo-relative form
 * cannot be proven. Never emits an absolute host path or a `..` traversal.
 */
export function sanitizeDefinitionSource(
  source: DefinitionSourceInput | undefined,
  options?: SanitizeDefinitionSourceOptions,
): SanitizedSourceRef | undefined {
  if (!source || typeof source.file !== 'string' || source.file.length === 0) {
    return undefined
  }
  if (!Number.isInteger(source.line) || (source.line as number) <= 0) {
    return undefined
  }

  let file = normalizeSeparators(source.file)

  if (isAbsolute(file)) {
    const root = options?.projectRoot
      ? normalizeSeparators(options.projectRoot).replace(/\/+$/, '')
      : undefined
    if (!root || !isAbsolute(root)) return undefined
    if (file === root) return undefined
    if (!file.startsWith(`${root}/`)) return undefined
    file = file.slice(root.length + 1)
  }

  // Strip a leading `./`, then reject anything that still walks upward. This
  // covers both plain relative `../x` inputs and absolute paths whose root-
  // relative remainder escaped via `..`.
  file = file.replace(/^\.\//, '')
  if (file.length === 0 || isAbsolute(file) || hasTraversal(file)) return undefined

  const column =
    Number.isInteger(source.column) && (source.column as number) > 0
      ? (source.column as number)
      : undefined

  return column === undefined
    ? { file, line: source.line as number }
    : { file, line: source.line as number, column }
}

/**
 * Build the `resolved-prompt` DefinitionRef for a prompt-resolution span. The id
 * matches the indexer's `prompt:<safeId(id)>` construction (see
 * `crates/primitives/src/prompt/facts.rs`).
 *
 * Pass the authored `id`; an absent id means the indexer falls back to the
 * compile-time local variable name, which the runtime cannot observe, so
 * callers must skip the ref entirely rather than guess.
 */
export function promptDefinitionRef(
  id: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return {
    id: `prompt:${safeDefinitionId(id)}`,
    kind: 'prompt',
    role: 'resolved-prompt',
    ...(source ? { source } : {}),
  }
}

/**
 * Build the `resolved-context` DefinitionRef for a context-resolution span. The
 * id matches the indexer's `context:<safeId(id)>` construction (see
 * `crates/primitives/src/context/facts.rs`).
 *
 * As with prompts, an absent authored `id` means the indexer used the local
 * variable name; callers must skip the ref rather than guess.
 */
export function contextDefinitionRef(
  id: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return {
    id: `context:${safeDefinitionId(id)}`,
    kind: 'context',
    role: 'resolved-context',
    ...(source ? { source } : {}),
  }
}

/**
 * Build the `invoked-tool` DefinitionRef for a `tool.call` span. The id matches
 * the indexer's `tool:<safeId(name || title)>` construction (see
 * `crates/primitives/src/tool/facts.rs`).
 *
 * Pass the tool's authored `name` (or `title`); the model-facing tool-map key is
 * not the canonical authored identity, and an absent authored name means the
 * indexer used the local variable name — so callers skip the ref instead.
 */
export function toolDefinitionRef(
  name: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return {
    id: `tool:${safeDefinitionId(name)}`,
    kind: 'tool',
    role: 'invoked-tool',
    ...(source ? { source } : {}),
  }
}

/**
 * Build the `invoked-agent` DefinitionRef for an `agent.run` span. The id matches
 * the indexer's `agent:<safeId(id)>` construction (see
 * `crates/primitives/src/agent/facts.rs`).
 *
 * Pass the compiled agent's `id`, which is a required authored field, so the
 * indexer never falls back to the local variable name. Composition stages backed
 * by a plain function have no compiled agent identity — callers must skip the ref
 * for those rather than emit the step label.
 */
export function agentDefinitionRef(
  id: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return {
    id: `agent:${safeDefinitionId(id)}`,
    kind: 'agent',
    role: 'invoked-agent',
    ...(source ? { source } : {}),
  }
}

/**
 * Build the `invoked-flow` DefinitionRef for a `flow.run` span. The id matches
 * the indexer's `flow:<safeId(name)>` construction (see
 * `crates/primitives/src/flow/facts.rs`).
 *
 * Pass the flow's authored `name` — the required first argument to `flow()`,
 * which the indexer reads as the literal name and never replaces with the local
 * variable name. This is the run-scoped definition key, not the random
 * per-execution `flowId`.
 */
export function flowDefinitionRef(
  name: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return {
    id: `flow:${safeDefinitionId(name)}`,
    kind: 'flow',
    role: 'invoked-flow',
    ...(source ? { source } : {}),
  }
}

/**
 * Build the `invoked-retriever` DefinitionRef for a `retrieval.query` span. The
 * id matches the indexer's `rag.retriever:<safeId(id)>` construction (see
 * `crates/primitives/src/rag/facts.rs`).
 *
 * Pass the retriever's authored `id` (the required, validated-non-empty
 * `config.id`, surfaced at runtime as `retrieverId`), so the indexer never falls
 * back to the local variable name.
 */
export function retrieverDefinitionRef(
  id: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return {
    id: `rag.retriever:${safeDefinitionId(id)}`,
    kind: 'rag.retriever',
    role: 'invoked-retriever',
    ...(source ? { source } : {}),
  }
}

/**
 * Build the `invoked-composition` DefinitionRef for a composition root span.
 * The id matches the indexer's `composition.<kind>:<safeId(id)>` construction
 * (see `crates/primitives/src/composition/facts.rs`).
 */
export function compositionDefinitionRef(
  kind: CompositionRefKind,
  id: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  const definitionKind = `composition.${kind}` as ProjectDefinitionKind
  return {
    id: `${definitionKind}:${safeDefinitionId(id)}`,
    kind: definitionKind,
    role: 'invoked-composition',
    ...(source ? { source } : {}),
  }
}

/**
 * Build the `invoked-blackboard` DefinitionRef for a blackboard memory span.
 * The id matches the indexer's `blackboard:<safeId(id)>` construction (see
 * `crates/primitives/src/blackboard/facts.rs`).
 */
export function blackboardDefinitionRef(
  id: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return {
    id: `blackboard:${safeDefinitionId(id)}`,
    kind: 'blackboard',
    role: 'invoked-blackboard',
    ...(source ? { source } : {}),
  }
}
