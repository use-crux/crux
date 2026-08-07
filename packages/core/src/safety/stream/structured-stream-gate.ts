/**
 * Streaming driver of the structured occurrence engine (RFC #173).
 *
 * Fed provider wire fragments, it scans readiness, applies matching manifest
 * operations to obtain canonical occurrences, selects boundaries, runs the shared
 * occurrence guard chain, applies copy-on-write rewrites, and advances a monotonic
 * release cursor over the canonical serialization:
 *
 *   wire fragment → scanner readiness → manifest ops → canonical occurrence
 *   → boundary selection → guard chain → rewrite/local validation → release cursor
 *
 * A sentinel-null deletion happens before path selection (a deleted optional path
 * emits no occurrence; a genuine null remains one). Release order is document
 * order: an open enclosing-gate container (a selected root/path occurrence still
 * receiving values) buffers its whole subtree until it closes and passes, so a
 * later ancestor/root rewrite never invalidates already-released descendants and
 * no later value leapfrogs an earlier unresolved prefix.
 *
 * @module
 */

import { selectedPath } from '../boundary'
import type { GuardrailContext } from '../guardrail/types'
import type { GuardrailBinding } from '../registry'
import type { StructuredOutputDecodeManifest } from '../../adapter/structured-output'
import { createStructuredReadinessScanner } from '../scanner/scanner'
import type { ReadinessPath } from '../scanner/events'
import { itemMatchesSelector, pathMatchesSelector, selectorSegments } from '../scanner/selector'
import { gateOccurrence, selectorOf, valueAt, type StructuredGateOptions } from './structured-gating'
import { createTextReplayEngine, type TextReplayEngine } from './text-replay'
import type { ReleaseGateKind } from './gates'
import { observeConstraintCheck } from '../constraint/runner'
import { StreamConstraintRejection } from '../constraint/settlement'
import type { ConstraintOccurrenceSettlement } from '../constraint/settlement'
import { constraintOccurrenceEntries } from '../constraint/occurrences'
import { subjectFingerprint } from '../constraint/fingerprint'
import type { Constraint, ConstraintAuditEntry, ConstraintContext } from '../constraint/types'

type Segment = string | number

/** An unresolved `assert` commit gate: it holds all release until it resolves. */
interface AssertGate {
  readonly constraint: Constraint
  /** The path selector to match a readiness event, or `undefined` for finish-only. */
  readonly selector: readonly string[] | undefined
  resolved: boolean
}

/** A progressive string occurrence gated sentence-by-sentence as it decodes. */
interface StringGate {
  readonly engine: TextReplayEngine
  readonly segments: readonly Segment[]
  /** Decoded characters already fed to the engine. */
  fed: number
  /** Gated content released by the engine so far (the open string's canonical value). */
  released: string
  done: boolean
}

export interface StructuredStreamGateOptions extends StructuredGateOptions {
  readonly objectBindings: readonly GuardrailBinding[]
  /** Compiled decode manifest; sentinel deletions apply before path selection. */
  readonly manifest?: StructuredOutputDecodeManifest
  /**
   * `assert` constraints that commit the whole attempt. While any is unresolved,
   * ALL release is held (`bufferedBy: 'constraint'`); a failure fails the stream
   * closed. Each resolves at its boundary's readiness (a path when its occurrence
   * completes, an array at close, root/composite at finish).
   */
  readonly assertConstraints?: readonly Constraint[]
  readonly constraintContext?: ConstraintContext
}

export interface StructuredStreamGate {
  /** Feed a provider wire fragment; returns canonical text released by the cursor. */
  readonly feed: (wireFragment: string) => Promise<string>
  /**
   * EOF: validate a complete root, run the root gate, and release the tail. The
   * sealed `{ text, parsed }` both derive from the accepted rewritten canonical
   * tree; `pending` is the final released tail (feed releases + `pending` = `text`).
   */
  readonly finish: () => Promise<{ readonly text: string; readonly parsed: unknown; readonly pending: string }>
  /** The highest-precedence active release gate, when the last feed released nothing. */
  readonly heldBy: () => ReleaseGateKind | undefined
  /**
   * Occurrence-precise settlement evidence for the asserts this attempt resolved:
   * one entry per passed occurrence (with a canonical subject fingerprint) plus the
   * matching pass audit. Completion uses it to skip re-evaluating unchanged settled
   * occurrences (so a `constraint.judge()` runs once).
   */
  readonly settlement: () => {
    readonly settled: readonly ConstraintOccurrenceSettlement[]
    readonly audit: readonly ConstraintAuditEntry[]
  }
}

/** Create the streaming structured occurrence + release-cursor engine. */
export function createStructuredStreamGate(options: StructuredStreamGateOptions): StructuredStreamGate {
  const scanner = createStructuredReadinessScanner()
  const gateOptions: StructuredGateOptions = {
    guardContext: options.guardContext,
    appendGuardrailAudit: options.appendGuardrailAudit,
    // Streaming rewrites validate against the same canonical schema node as the
    // batch driver before the release cursor advances.
    ...(options.canonicalSchema ? { canonicalSchema: options.canonicalSchema } : {}),
  }
  const sentinelOperations = (options.manifest?.operations ?? []).filter(
    (operation) => operation.kind === 'delete-null-sentinel',
  )
  // Guarded sentinel nulls whose union discriminator has not streamed yet. Each
  // resolves when an enclosing container closes (its raw value then carries the
  // discriminator): a confirmed sentinel stays deleted, a refuted one is a
  // genuine null appended to the canonical tree (appending after the parent's
  // already-ingested keys keeps the released prefix stable).
  const pendingSentinels = new Map<string, readonly Segment[]>()
  const isSentence = (binding: GuardrailBinding): boolean =>
    selectorOf(binding).kind === 'path' && (binding.boundary as { readonly unit?: string }).unit === 'sentence'
  // A `.path().sentences()` string is gated progressively (below), not as a whole
  // path occurrence — so it releases completed sentences before its closing quote
  // and is never treated as a subtree-buffering enclosing gate.
  const sentenceBindings = options.objectBindings.filter(isSentence)
  const pathBindings = options.objectBindings.filter(
    (binding) => selectorOf(binding).kind === 'path' && !isSentence(binding),
  )
  const itemBindings = options.objectBindings.filter((binding) => selectorOf(binding).kind === 'item')
  const rootBindings = options.objectBindings.filter((binding) => selectorOf(binding).kind === 'root')
  // Root/path selectors identify enclosing-gate containers that must buffer their
  // subtree until they close and pass.
  const enclosingSelectors = [...rootBindings, ...pathBindings].map((binding) => selectorOf(binding))

  let canonical: unknown = undefined
  let released = 0
  const stringGates = new Map<string, StringGate>()
  // Paths whose string is open (gated so far, closing quote withheld from release).
  const openStringKeys = new Set<string>()

  // `assert` commit gates: while any is unresolved, all release is held; a path
  // gate resolves at its occurrence's readiness, an array/root/composite at finish.
  const assertGates: AssertGate[] = (options.assertConstraints ?? []).map((constraint) => ({
    constraint,
    selector: assertSelector(constraint),
    resolved: false,
  }))
  // Occurrence-precise settlement evidence recorded as asserts resolve (pass).
  const settledOccurrences: ConstraintOccurrenceSettlement[] = []
  const settledAudit: ConstraintAuditEntry[] = []
  let lastHeldBy: ReleaseGateKind | undefined

  function createStringGate(binding: GuardrailBinding, segments: readonly Segment[]): StringGate {
    return {
      engine: createTextReplayEngine({
        textBindings: [binding],
        mode: 'stream',
        guardContext: () => options.guardContext,
        appendGuardrailAudit: options.appendGuardrailAudit,
      }),
      segments,
      fed: 0,
      released: '',
      done: false,
    }
  }

  async function feed(wireFragment: string): Promise<string> {
    const events = scanner.write(wireFragment)
    for (const event of events) {
      const value = event.value
      const sentence =
        event.path.length > 0 && typeof value === 'string'
          ? sentenceBindings.find((binding) => pathMatchesSelector(event.path, selectorOf(binding).segments))
          : undefined
      if (sentence && typeof value === 'string') await closeStringGate(sentence, event.path, value)
      else await ingest(event.path, value)
      await triggerAsserts(event.path)
    }
    await pumpOpenString()
    return releaseReady(false)
  }

  async function finish(): Promise<{ text: string; parsed: unknown; pending: string }> {
    const end = scanner.end()
    for (const event of end.events) {
      const value = event.value
      const sentence =
        event.path.length > 0 && typeof value === 'string'
          ? sentenceBindings.find((binding) => pathMatchesSelector(event.path, selectorOf(binding).segments))
          : undefined
      if (sentence && typeof value === 'string') await closeStringGate(sentence, event.path, value)
      else await ingest(event.path, value)
      await triggerAsserts(event.path)
    }
    // Resolve every remaining assert gate at completion (root/composite, and any
    // path whose occurrence never arrived — a vacuously-satisfied missing optional).
    for (const gate of assertGates) if (!gate.resolved) await evaluateAssert(gate)
    const pending = releaseReady(true)
    return { text: serializeCanonical(canonical, new Set(), new Set()).text, parsed: canonical, pending }
  }

  /** Resolve any assert gate whose selected occurrence just became ready at `path`. */
  async function triggerAsserts(path: ReadinessPath): Promise<void> {
    for (const gate of assertGates) {
      if (!gate.resolved && gate.selector && pathMatchesSelector(path, gate.selector)) {
        await evaluateAssert(gate)
      }
    }
  }

  /** Evaluate one assert gate over the current canonical tree; resolve, or fail closed. */
  async function evaluateAssert(gate: AssertGate): Promise<void> {
    if (gate.resolved || !options.constraintContext) return
    const text = serializeCanonical(canonical, new Set(), new Set()).text
    const check = await observeConstraintCheck(gate.constraint, { text, parsed: canonical }, options.constraintContext)
    if (check.result.pass) {
      gate.resolved = true
      // Record that this exact occurrence value passed (occurrence-precise), so
      // completion can skip re-evaluating it while it stays unchanged. A gate only
      // resolves once its selected occurrence set is closed, so `closed: true`.
      for (const entry of constraintOccurrenceEntries(gate.constraint.on, { text, parsed: canonical })) {
        settledOccurrences.push({
          constraint: gate.constraint.id,
          occurrence: entry.occurrence,
          subjectFingerprint: subjectFingerprint(entry.subject),
          pass: true,
          closed: true,
        })
      }
      settledAudit.push({
        constraint: gate.constraint.id,
        ...(gate.constraint.category !== undefined ? { category: gate.constraint.category } : {}),
        severity: gate.constraint.severity,
        pass: true,
        attempts: 1,
        durationMs: check.durationMs,
      })
      return
    }
    const feedback = check.result.pass ? '' : check.result.feedback
    const entry: ConstraintAuditEntry = {
      constraint: gate.constraint.id,
      ...(gate.constraint.category !== undefined ? { category: gate.constraint.category } : {}),
      severity: gate.constraint.severity,
      pass: false,
      feedback,
      attempts: 1,
      durationMs: check.durationMs,
    }
    // Non-terminal: the coordinator retries (adapter) or a standalone stream
    // translates this to the public `ConstraintViolationError`.
    throw new StreamConstraintRejection({
      failures: [
        {
          name: gate.constraint.id,
          ...(gate.constraint.category !== undefined ? { category: gate.constraint.category } : {}),
          severity: gate.constraint.severity,
          feedback,
          maxRetries: gate.constraint.maxRetries,
        },
      ],
      text,
      settlement: {
        attemptId: '',
        settled: [
          {
            constraint: gate.constraint.id,
            occurrence: gate.selector ?? [],
            subjectFingerprint: '',
            pass: false,
            closed: true,
          },
        ],
        audit: [entry],
      },
    })
  }

  /** Feed the open sentence string's newly-decoded content and release its sentences. */
  async function pumpOpenString(): Promise<void> {
    const open = scanner.openString()
    if (!open) return
    const binding = sentenceBindings.find((candidate) =>
      pathMatchesSelector(open.path, selectorOf(candidate).segments),
    )
    if (!binding) return
    const segments = open.path.map((segment) => segment)
    const key = pathKey(segments)
    let gate = stringGates.get(key)
    if (!gate) {
      gate = createStringGate(binding, segments)
      stringGates.set(key, gate)
      openStringKeys.add(key)
    }
    if (gate.done) return
    const delta = open.decoded.slice(gate.fed)
    if (delta.length === 0) return
    gate.fed = open.decoded.length
    gate.released += await gate.engine.feed(delta)
    canonical = setAt(canonical, segments, gate.released)
  }

  /** Close a sentence string: gate its remaining decoded tail and seal it (fails closed if held). */
  async function closeStringGate(binding: GuardrailBinding, path: ReadinessPath, value: string): Promise<void> {
    const segments = path.map((segment) => segment)
    const key = pathKey(segments)
    let gate = stringGates.get(key)
    if (!gate) {
      gate = createStringGate(binding, segments)
      stringGates.set(key, gate)
    }
    if (value.length > gate.fed) {
      gate.released += await gate.engine.feed(value.slice(gate.fed))
      gate.fed = value.length
    }
    const seal = await gate.engine.finish()
    gate.released = seal.text
    gate.done = true
    openStringKeys.delete(key)
    canonical = setAt(canonical, segments, gate.released)
  }

  async function ingest(path: ReadinessPath, value: unknown): Promise<void> {
    if (path.length === 0) {
      // Root close: every discriminator is known, so pending sentinels resolve
      // before the root object occurrence is gated over the canonical tree.
      // While the root is open it is the enclosing gate, so nothing has released.
      resolvePendingSentinels([], value)
      for (const binding of rootBindings) {
        canonical = await gateOccurrence(canonical, [], binding, gateOptions)
      }
      return
    }
    const segments = path.map((segment) => segment)
    const isContainer = value !== null && typeof value === 'object'

    if (!isContainer) {
      if (value === null) {
        const state = sentinelStateAt(segments)
        if (state === 'sentinel') return // deleted sentinel: no canonical value, no occurrence
        if (state === 'pending') {
          pendingSentinels.set(pathKey(segments), segments)
          return
        }
      }
      canonical = setAt(canonical, segments, value)
    } else {
      if (valueAt(canonical, segments) === undefined) {
        // An empty (or all-sentinel) container has no leaf events; seed it canonically.
        canonical = setAt(canonical, segments, Array.isArray(value) ? [] : {})
      }
      resolvePendingSentinels(segments, value)
    }

    // Gate the completed occurrence (a deleted sentinel returned above).
    for (const binding of pathBindings) {
      if (pathMatchesSelector(path, selectorOf(binding).segments)) {
        canonical = await gateOccurrence(canonical, segments, binding, gateOptions)
      }
    }
    for (const binding of itemBindings) {
      if (itemMatchesSelector(path, selectorOf(binding).segments)) {
        canonical = await gateOccurrence(canonical, segments, binding, gateOptions)
      }
    }
  }

  /** Release the canonical prefix up to the earliest open enclosing-gate container. */
  function releaseReady(final: boolean): string {
    // Nothing to release before the root value has begun materializing — but an
    // unresolved assert still reports itself as the reason nothing is flowing.
    if (canonical === undefined) {
      lastHeldBy = !final && assertGates.some((gate) => !gate.resolved) ? 'constraint' : undefined
      return ''
    }
    const openPaths = final ? [] : scanner.openContainerPaths().map((segments) => segments.map((s) => s))
    const { text, startOf } = serializeCanonical(
      canonical,
      new Set(openPaths.map(pathKey)),
      final ? new Set<string>() : openStringKeys,
    )

    let limit = text.length
    if (!final) {
      for (const openPath of openPaths) {
        if (isEnclosingGate(openPath)) {
          const start = startOf.get(pathKey(openPath))
          if (start !== undefined) limit = Math.min(limit, start)
        }
      }
    }

    // An unresolved `assert` gate holds the WHOLE attempt (a failed assert rejects
    // it, so earlier bytes must not leak). It outranks a local guardrail hold.
    const assertHeld = !final && assertGates.some((gate) => !gate.resolved)
    if (assertHeld) limit = released

    if (limit <= released) {
      lastHeldBy = assertHeld ? 'constraint' : text.length > released ? 'guardrail' : undefined
      return ''
    }
    const chunk = text.slice(released, limit)
    released = limit
    lastHeldBy = undefined
    return chunk
  }

  function isEnclosingGate(openPath: readonly Segment[]): boolean {
    return enclosingSelectors.some((selector) =>
      selector.kind === 'root'
        ? openPath.length === 0
        : pathMatchesSelector(openPath, selector.segments),
    )
  }

  /**
   * Whether a null at `segments` is a transport sentinel. `'sentinel'` when a
   * matching operation's guards all hold (or it has none), `'pending'` when a
   * matching guarded operation's discriminator has not streamed yet, `'genuine'`
   * when every matching operation's guards are refuted (another union branch).
   */
  function sentinelStateAt(segments: readonly Segment[]): 'sentinel' | 'genuine' | 'pending' {
    let pending = false
    for (const operation of sentinelOperations) {
      if (!manifestPathMatches(operation.path, segments)) continue
      const verdict = guardsVerdict(operation.guards, segments, undefined, [])
      if (verdict === 'match') return 'sentinel'
      if (verdict === 'unknown') pending = true
    }
    return pending ? 'pending' : 'genuine'
  }

  /**
   * Evaluate an operation's guards for a concrete occurrence path, reading each
   * discriminator from the canonical tree or, past `containerPath`, from a just
   * closed container's raw `containerValue`.
   */
  function guardsVerdict(
    guards: readonly { depth: number; key: string; value: unknown }[] | undefined,
    segments: readonly Segment[],
    containerValue: unknown,
    containerPath: readonly Segment[],
  ): 'match' | 'mismatch' | 'unknown' {
    let unknown = false
    for (const guard of guards ?? []) {
      const discriminatorPath = [...segments.slice(0, guard.depth), guard.key]
      let discriminator = valueAt(canonical, discriminatorPath)
      if (discriminator === undefined && containerPath.length <= discriminatorPath.length) {
        discriminator = valueAt(containerValue, discriminatorPath.slice(containerPath.length))
      }
      if (discriminator === undefined) unknown = true
      else if (discriminator !== guard.value) return 'mismatch'
    }
    return unknown ? 'unknown' : 'match'
  }

  /** Resolve pending guarded sentinels under a closed container's raw value. */
  function resolvePendingSentinels(containerPath: readonly Segment[], containerValue: unknown): void {
    for (const [key, segments] of pendingSentinels) {
      if (!containerPath.every((segment, index) => segments[index] === segment)) continue
      let genuine = true
      let unknown = false
      for (const operation of sentinelOperations) {
        if (!manifestPathMatches(operation.path, segments)) continue
        const verdict = guardsVerdict(operation.guards, segments, containerValue, containerPath)
        if (verdict === 'match') {
          genuine = false
          break
        }
        if (verdict === 'unknown') unknown = true
      }
      if (!genuine) pendingSentinels.delete(key)
      else if (!unknown) {
        pendingSentinels.delete(key)
        canonical = setAt(canonical, segments, null)
      }
    }
  }

  return {
    feed,
    finish,
    heldBy: () => lastHeldBy,
    settlement: () => ({ settled: settledOccurrences, audit: settledAudit }),
  }
}

/**
 * The readiness selector that resolves an assert gate, or `undefined` when it
 * resolves only at completion (root object, composite, or text).
 */
function assertSelector(constraint: Constraint): readonly string[] | undefined {
  if (constraint.on.id !== 'model.output.object') return undefined
  const path = selectedPath(constraint.on)
  return path ? selectorSegments(path) : undefined
}

/** Match a manifest op path (with `*` array wildcards) against a canonical path. */
function manifestPathMatches(opPath: readonly (string | number)[], segments: readonly Segment[]): boolean {
  if (opPath.length !== segments.length) return false
  return opPath.every((opSegment, index) => {
    const segment = segments[index]
    if (opSegment === '*') return typeof segment === 'number'
    return String(opSegment) === String(segment)
  })
}

/** Copy-on-write set at a segment path, creating intermediate containers. */
function setAt(root: unknown, segments: readonly Segment[], value: unknown): unknown {
  if (segments.length === 0) return value
  const [head, ...rest] = segments
  if (typeof head === 'number') {
    const array = Array.isArray(root) ? [...root] : []
    array[head] = setAt(array[head], rest, value)
    return array
  }
  const object: Record<string, unknown> = root !== null && typeof root === 'object' && !Array.isArray(root) ? { ...(root as Record<string, unknown>) } : {}
  object[head] = setAt(object[head], rest, value)
  return object
}

/**
 * Serialize the canonical tree, leaving `openKeys` containers unclosed and each
 * `openStrings` string without its closing quote (its sentences are still being
 * gated); record each path's start offset.
 */
function serializeCanonical(
  value: unknown,
  openKeys: ReadonlySet<string>,
  openStrings: ReadonlySet<string>,
): { text: string; startOf: Map<string, number> } {
  const startOf = new Map<string, number>()
  let text = ''
  const emit = (node: unknown, path: readonly Segment[]): void => {
    startOf.set(pathKey(path), text.length)
    if (node === null || typeof node !== 'object') {
      const encoded = JSON.stringify(node) ?? 'null'
      // An open sentence string is emitted without its closing quote so only its
      // released sentences reach the cursor; the closing quote lands at string close.
      text += typeof node === 'string' && openStrings.has(pathKey(path)) ? encoded.slice(0, -1) : encoded
      return
    }
    const open = openKeys.has(pathKey(path))
    if (Array.isArray(node)) {
      text += '['
      node.forEach((item, index) => {
        if (index > 0) text += ','
        emit(item, [...path, index])
      })
      if (!open) text += ']'
    } else {
      text += '{'
      Object.keys(node).forEach((key, index) => {
        if (index > 0) text += ','
        text += `${JSON.stringify(key)}:`
        emit((node as Record<string, unknown>)[key], [...path, key])
      })
      if (!open) text += '}'
    }
  }
  emit(value, [])
  return { text, startOf }
}

/**
 * Unambiguous identity for one occurrence path.
 *
 * @remarks
 * JSON encoding is used because it is injective over the segment domain: it escapes any
 * character a property name may contain (including NUL and colons) and distinguishes a
 * numeric index from a numeric-looking property name (`1` vs `"1"`). A delimiter-joined
 * encoding is not injective — a property name containing the delimiter can forge another
 * path's key and make two different occurrences share one gate engine.
 */
function pathKey(path: readonly Segment[]): string {
  return JSON.stringify(path)
}
