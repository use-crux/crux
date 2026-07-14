import {
  CRUX_OBSERVABILITY_SCHEMA_VERSION,
  CRUX_PRIMITIVE_FAMILY_BY_NAME,
  type AttributesFor,
  type CruxAttributes,
  type CruxArtifactId,
  type CruxArtifactKind,
  type CruxEdgeType,
  type CruxGraphNodeRef,
  type CruxMetrics,
  type CruxPrimitiveName,
  type CruxRunId,
  type CruxRunStatus,
  type CruxSegmentId,
  type CruxSpanStatus,
  type CruxSpanId,
  type CruxTraceId,
  type DefinitionRef,
} from './contract'
import { channelHasSubscribers, publishObservabilityChannel } from './channel'
import {
  createCruxArtifactId,
  createCruxEdgeId,
  createCruxRecordId,
  createCruxRunId,
  createCruxSegmentId,
  createCruxSpanEventId,
  createCruxSpanId,
  createCruxTraceId,
} from './ids'
import { normalizeObservedError, observedErrorSummary } from './errors'
import { applyObservabilityCapturePolicyToRecord } from './capture-policy'
import { sanitizeRecord } from './sanitize'
import {
  applyCruxCorrelators,
  mergeCruxCorrelators,
  type CruxCorrelators,
} from './correlators'
import {
  hasObservabilitySubscribers,
  observabilitySubscriberErrorCount,
  publishObservabilitySubscribers,
  resetObservabilitySubscribers,
} from './subscribers'
import type { CruxObservabilityTransport } from './transport'
import { validateRecordForEmission } from './validate-record'
import {
  createDeliveryEngine,
  type DeliveryDiagnostic,
} from './delivery/engine'
import type {
  ObservabilityDeliveryOptions,
  ObservabilityFlushOptions,
  ObservabilityFlushResult,
} from './delivery/options'
import { activeHostLifecycle, runWithHostLifecycle } from './delivery/host-scope'
import { remainingHostDeadlineMs, type CruxHostLifecycle } from '../runtime/api/host-lifecycle'
import { getHooks } from '../runtime/runtime'
import {
  currentCruxCorrelators,
  currentObservabilityContext,
  withCruxCorrelators,
  withObservabilityContext,
  type CapturedObservabilityContext,
  type ObservabilityContext,
} from './context'
import {
  createRecordSequencer,
  type UnsequencedCruxGraphRecord,
} from './sequence'
import {
  currentQualityObservabilityCaptureSession,
  shouldQuarantineQualityObservabilityWrite,
} from './quality-capture-hooks'
import {
  continuationIdentity,
  createPropagationCarrier,
  type CruxPropagationCarrier,
} from './continuation'
import {
  CruxDeploymentIdentitySchema,
  type CruxDeploymentIdentity,
} from '../project-index'

export {
  subscribeObservability,
  type CruxObservabilitySubscriber,
} from './subscribers'
export { hasObservabilitySubscribers } from './subscribers'
export { __setAlsForTesting } from './context'
export type { CapturedObservabilityContext } from './context'
export type {
  ObservabilityDeliveryOptions,
  ObservabilityFlushOptions,
  ObservabilityFlushResult,
} from './delivery/options'
export type { DeliveryDiagnostic } from './delivery/engine'

export interface ConfigureObservabilityOptions {
  transport?: CruxObservabilityTransport
  delivery?: ObservabilityDeliveryOptions
  /**
   * Correlators applied when no active observability context provides them.
   *
   * Devtools uses this for process-level session grouping. Explicit
   * `propagateAttributes()` scopes override these defaults.
   */
  defaultCorrelators?: CruxCorrelators
  /** Deployment identity captured by each logical run created by this layer. */
  identity?: CruxDeploymentIdentity
}

export interface ObservabilityDiagnostics {
  readonly pendingDeliveries: number
  readonly queuedRecords: number
  readonly queuedBytes: number
  readonly droppedRecords: number
  /**
   * Total delivery failures observed since the diagnostics were last reset.
   *
   * Unlike `deliveryErrors`, this is not capped; it is intended for health
   * checks that need an exact monotonic failure count for the current runtime.
   */
  readonly deliveryErrorCount: number
  readonly invalidRecords: number
  readonly redactedRecords: number
  readonly contextlessRecords: number
  readonly deliveryErrors: readonly DeliveryDiagnostic[]
  readonly acceptedRecords: number
  readonly retriedRecords: number
  readonly permanentlyRejectedRecords: number
  readonly overflowDroppedRecords: number
  readonly overflowDroppedBytes: number
  readonly deadlineDroppedRecords: number
  readonly reconfiguredDroppedRecords: number
  /** Records still in flight to a transport superseded by reconfiguration; not yet settled. */
  readonly reconfiguredRemainingRecords: number
  /** Serialized bytes backing {@link reconfiguredRemainingRecords}. */
  readonly reconfiguredRemainingBytes: number
  /** Superseded delivery promises still retained for a drain to await, bounded by `maxPendingDeliveries`. */
  readonly reconfiguredTrackedDeliveries: number
  readonly subscriberErrors: number
}

export interface OpenObservedSpan {
  readonly runId: CruxRunId
  readonly traceId: CruxTraceId
  /** Segment that owns records emitted by this open span. */
  readonly segmentId: CruxSegmentId
  readonly spanId: CruxSpanId
  readonly parentSpanId: CruxSpanId | null
  /**
   * Run work with this span as the active observability context.
   *
   * Context propagation is best-effort and never changes user-code behavior if
   * the host runtime does not provide `AsyncLocalStorage`.
   */
  withContext<T>(fn: () => T | Promise<T>): T | Promise<T>
  /**
   * Merge attributes into the span end record without ending the span.
   *
   * Later calls override earlier keys. Use this for metadata discovered after
   * span start; terminal attributes can still be passed to {@link end}.
   */
  setAttributes(attributes: CruxAttributes): void
  /**
   * End the span once.
   *
   * Raw attribute bags are intentionally not accepted. Pass terminal attributes
   * as `{ attributes }`, or call {@link setAttributes} before ending.
   */
  end(options?: EndObservedSpanOptions): void
  /** End the span with status `error` and emit normalized error evidence. */
  error(error: unknown, attributes?: CruxAttributes): void
}

export interface OpenObservedRun {
  readonly runId: CruxRunId
  readonly traceId: CruxTraceId
  /** Segment that owns records emitted by this open run. */
  readonly segmentId: CruxSegmentId
  captureContext(): CapturedObservabilityContext
  /** Capture serializable correlation without changing lifecycle state. */
  captureContinuation(): CruxPropagationCarrier
  withContext<T>(fn: () => T | Promise<T>): T | Promise<T>
  /** Close this physical segment without terminalizing its logical run. */
  suspend(options: SuspendObservedRunOptions): CruxPropagationCarrier
  end(options?: EndObservedRunOptions): void
  error(
    error: unknown,
    options?: Omit<EndObservedRunOptions, 'status' | 'error'>,
  ): void
}

export interface SuspendObservedRunOptions {
  reason: string
  attributes?: CruxAttributes
}

export interface ResumeObservedRunOptions {
  reason: string
  attributes?: CruxAttributes
}

export interface ObserveRunOptions {
  /**
   * Existing trace identifier to join.
   *
   * Use this when a higher-level workflow owns the umbrella trace and starts
   * multiple run roots inside it. Omit to create a fresh W3C trace id.
   */
  traceId?: CruxTraceId
  name: string
  rootPrimitive: CruxPrimitiveName
  attributes?: CruxAttributes
  /** Authored definitions directly associated with this run boundary. */
  definitionRefs?: DefinitionRef[]
}

export interface EndObservedRunOptions {
  status?: Exclude<CruxRunStatus, 'running' | 'suspended'>
  metrics?: CruxMetrics
  error?: unknown
  attributes?: CruxAttributes
}

export interface EndObservedSpanOptions {
  status?: Exclude<CruxSpanStatus, 'running'>
  metrics?: CruxMetrics
  error?: unknown
  attributes?: CruxAttributes
}

export interface ObserveSpanOptions<
  P extends CruxPrimitiveName = CruxPrimitiveName,
> {
  name: string
  primitive: P
  attributes?: AttributesFor<P>
  /**
   * Project Index definitions this span resolved or invoked. Emitted verbatim
   * on the `span:start` record so the runtime→index join can attach evidence.
   * Callers are responsible for canonical id construction and source
   * sanitization (see `./definition-ref`).
   */
  definitionRefs?: DefinitionRef[]
  /**
   * When a span starts outside an active run, `observe.span()` normally opens
   * an implicit run so direct primitive calls remain inspectable. Detail
   * spans can disable that behavior when they should only enrich an existing
   * run and must not become the visible run boundary themselves.
   *
   * @default true
   */
  implicitRun?: boolean
  /**
   * Optional predetermined span id for durable correlation.
   *
   * Named defer stages a JSON-safe `scheduledSpanId` before wake so a later
   * process can emit a `triggered` edge to the acceptance span. Callers must
   * supply a valid Crux span id (16 lowercase hex characters).
   */
  spanId?: CruxSpanId
}

export interface ObserveEventOptions {
  name: string
  attributes?: CruxAttributes
}

export interface ObserveArtifactOptions {
  artifactId?: CruxArtifactId
  kind: CruxArtifactKind
  contentType: string
  encoding: 'json' | 'text' | 'bytes' | 'reference'
  sizeBytes?: number
  hash?: string
  preview?: unknown
  uri?: string
  attributes?: CruxAttributes
}

export interface ObserveEdgeOptions {
  edgeType: CruxEdgeType
  from: CruxGraphNodeRef
  to: CruxGraphNodeRef
  attributes?: CruxAttributes
}

const deliveryEngine = createDeliveryEngine()
const recordSequencer = createRecordSequencer()
let invalidRecords = 0
let redactedRecords = 0
let contextlessRecords = 0
let warnedAboutInvalidRecord = false
let warnedAboutRedactedRecord = false
let warnedAboutContextlessRecord = false

interface ObservabilityConfigurationLayer {
  readonly token: number
  readonly parentToken: number
  readonly previousTransport: CruxObservabilityTransport | undefined
  readonly previousDeliveryOptions: ReturnType<
    typeof deliveryEngine.deliveryOptions
  >
  readonly previousDefaultCorrelators: CruxCorrelators | undefined
  readonly previousDeploymentIdentity: CruxDeploymentIdentity | undefined
}

let nextConfigurationToken = 0
let activeConfigurationToken = 0
const configurationParents = new Map<number, number>()

const maxEndedRunIds = 10_000
type EndedRunStatus = Exclude<CruxRunStatus, 'running'>
const endedRunStatuses = new Map<CruxRunId, EndedRunStatus>()
let defaultCorrelators: CruxCorrelators | undefined
let deploymentIdentity: CruxDeploymentIdentity | undefined
// `null` is an authoritative deployment-unspecified run identity. Retaining the
// sentinel prevents a later continuation from attaching identity to a run that
// began without one.
const runDeploymentIdentities = new Map<
  CruxRunId,
  CruxDeploymentIdentity | null
>()

function currentContext(): ObservabilityContext | undefined {
  return currentObservabilityContext()
}

function withContext<R>(context: ObservabilityContext, fn: () => R): R {
  return withObservabilityContext(context, () => activateSpan(context, fn))
}

/**
 * Run `fn` through the installed {@link SpanActivationHook}, if any.
 *
 * This is the single choke point every `withContext()` call passes through
 * (`observe.run`, `observe.span`, `observe.openSpan().withContext`,
 * `observe.openRun().withContext`, resumed segments), so a telemetry plugin
 * that installs the hook activates its real span around the actual callback
 * for every instrumented entry point without per-call-site wiring.
 */
function activateSpan<R>(context: ObservabilityContext, fn: () => R): R {
  const hook = getHooks().spanActivationHook
  if (!hook) return fn()
  const currentSpanId = context.spanStack[context.spanStack.length - 1]
  return hook(captureContextValue(context, context.spanStack, currentSpanId), fn)
}

/**
 * Merge explicit resume attributes with any attributes an installed
 * telemetry plugin derives from the propagation carrier (e.g. allowlisted
 * W3C baggage). The hook never throws through app work; a throw or
 * non-object return is treated as "nothing to add".
 */
function resumeAttributesFor(
  carrier: CruxPropagationCarrier,
  explicit: CruxAttributes | undefined,
): CruxAttributes | undefined {
  const hook = getHooks().telemetryResumeAttributesHook
  if (!hook) return explicit
  let derived: CruxAttributes | undefined
  try {
    derived = hook(carrier)
  } catch {
    derived = undefined
  }
  if (!derived || Object.keys(derived).length === 0) return explicit
  return { ...derived, ...(explicit ?? {}) }
}

function now(): string {
  return new Date().toISOString()
}

function durationSince(startedAtMs: number): number {
  return Math.max(0, Date.now() - startedAtMs)
}

function emit(
  record: UnsequencedCruxGraphRecord,
  correlators = effectiveCorrelators(),
): void {
  const runDeployment = runDeploymentIdentities.get(record.runId)
  const recordWithDeployment = runDeployment
    ? { ...record, deployment: runDeployment }
    : record
  const sequencedRecord = recordSequencer.assign(
    applyCruxCorrelators(recordWithDeployment, correlators),
  )
  const privacy = applyObservabilityCapturePolicyToRecord(sequencedRecord)
  if (!privacy.ok) {
    recordRedactedRecord(privacy.error)
    return
  }
  if (!sameDeploymentIdentity(sequencedRecord, privacy.record)) {
    recordRedactedRecord(
      new Error('Observability redaction cannot rewrite deployment identity'),
    )
    return
  }

  let validated: ReturnType<typeof validateRecordForEmission>
  try {
    validated = validateRecordForEmission(sanitizeRecord(privacy.record))
  } catch (error) {
    recordInvalidRecord(['Record validation threw unexpectedly', String(error)])
    return
  }
  if (!validated.ok) {
    recordInvalidRecord(validated.issues)
    return
  }

  if (shouldQuarantineQualityObservabilityWrite()) return

  currentQualityObservabilityCaptureSession()?.send([validated.record])
  publishObservabilitySubscribers(validated.record)
  publishObservabilityChannel(validated.record)
  deliveryEngine.enqueue(validated.record)
}

function sameDeploymentIdentity(
  before: { readonly deployment?: CruxDeploymentIdentity },
  after: { readonly deployment?: CruxDeploymentIdentity },
): boolean {
  return before.deployment?.projectId === after.deployment?.projectId &&
    before.deployment?.manifestId === after.deployment?.manifestId &&
    before.deployment?.deploymentId === after.deployment?.deploymentId
}

function emitObserved(
  createRecord: () => UnsequencedCruxGraphRecord,
  correlators?: CruxCorrelators | null,
): void {
  if (!hasActiveObservabilitySinks()) return
  try {
    emit(
      createRecord(),
      correlators === null ? undefined : effectiveCorrelators(correlators),
    )
  } catch (error) {
    recordInvalidRecord([
      'Observability record construction threw unexpectedly',
      String(error),
    ])
  }
}

function hasActiveObservabilitySinks(): boolean {
  return (
    deliveryEngine.currentTransport() !== undefined ||
    currentQualityObservabilityCaptureSession() !== undefined ||
    hasObservabilitySubscribers() ||
    channelHasSubscribers()
  )
}

function effectiveCorrelators(
  preferred?: CruxCorrelators,
): CruxCorrelators | undefined {
  return preferred ?? currentCruxCorrelators() ?? defaultCorrelators
}

function recordInvalidRecord(issues: readonly string[]): void {
  invalidRecords += 1
  if (warnedAboutInvalidRecord) return
  if (!shouldWarnAboutInvalidRecords()) return

  warnedAboutInvalidRecord = true
  console.warn(
    '[crux] invalid observability record dropped; continuing without interrupting execution.',
    issues,
  )
}

function recordRedactedRecord(error: unknown): void {
  redactedRecords += 1
  if (warnedAboutRedactedRecord) return
  if (!shouldWarnAboutInvalidRecords()) return

  warnedAboutRedactedRecord = true
  console.warn(
    '[crux] observability record redacted or dropped by privacy policy.',
    error,
  )
}

function shouldWarnAboutInvalidRecords(): boolean {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Readonly<Record<string, string | undefined>> }
  }
  const nodeEnv = runtime.process?.env?.NODE_ENV
  return nodeEnv !== 'production' && nodeEnv !== 'test'
}

function shouldWarnAboutRuntimeLimitations(): boolean {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Readonly<Record<string, string | undefined>> }
  }
  const nodeEnv = runtime.process?.env?.NODE_ENV
  return nodeEnv !== 'production' && nodeEnv !== 'test'
}

function errorContext(attributes?: CruxAttributes): {
  readonly attributes?: CruxAttributes
  readonly phase?: string
  readonly errorKind?: string
} {
  return {
    ...(attributes ? { attributes } : {}),
    ...stringAttribute(attributes, 'phase', 'phase'),
    ...stringAttribute(attributes, 'errorKind', 'errorKind'),
  }
}

function stringAttribute(
  attributes: CruxAttributes | undefined,
  key: string,
  outputKey: 'phase' | 'errorKind',
) {
  const value = attributes?.[key]
  return typeof value === 'string' && value.length > 0
    ? { [outputKey]: value }
    : {}
}

function emitObservedErrorEvidence(
  context: ObservabilityContext,
  spanId: CruxSpanId,
  error: unknown,
  attributes?: CruxAttributes,
): void {
  if (!hasActiveObservabilitySinks()) return

  try {
    const normalized = normalizeObservedError(error, errorContext(attributes))
    const stack = normalized.thrown === 'error' ? normalized.stack : undefined
    const phase = stringField(attributes, 'phase')
    const errorKind =
      stringField(attributes, 'errorKind') ?? normalized.summary.category
    const eventAttributes: CruxAttributes = {
      ...attributes,
      'exception.message': normalized.summary.message,
      ...(normalized.summary.name
        ? { 'exception.type': normalized.summary.name }
        : {}),
      ...(stack ? { 'exception.stacktrace': stack } : {}),
      ...(phase ? { 'error.phase': phase } : {}),
      ...(errorKind ? { 'error.kind': errorKind } : {}),
    }

    emitObserved(
      () => ({
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: createCruxRecordId(),
        type: 'span:event',
        runId: context.runId,
        segmentId: context.segmentId,
        traceId: context.traceId,
        spanId,
        eventId: createCruxSpanEventId(),
        name: 'exception',
        timestamp: now(),
        attributes: eventAttributes,
      }),
      context.correlators ?? null,
    )

    if (stack) {
      emitObserved(
        () => ({
          schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
          recordId: createCruxRecordId(),
          type: 'artifact',
          runId: context.runId,
          segmentId: context.segmentId,
          traceId: context.traceId,
          spanId,
          artifactId: createCruxArtifactId(),
          kind: 'error.stack',
          createdAt: now(),
          contentType: 'text/plain',
          encoding: 'text',
          preview: stack,
          ...(attributes ? { attributes } : {}),
        }),
        context.correlators ?? null,
      )
    }

    emitObserved(
      () => ({
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: createCruxRecordId(),
        type: 'artifact',
        runId: context.runId,
        segmentId: context.segmentId,
        traceId: context.traceId,
        spanId,
        artifactId: createCruxArtifactId(),
        kind: 'error.raw',
        createdAt: now(),
        contentType: 'application/json',
        encoding: 'json',
        preview: normalized.raw,
        ...(attributes ? { attributes } : {}),
      }),
      context.correlators ?? null,
    )
  } catch (normalizationError) {
    recordInvalidRecord([
      'Error evidence construction threw unexpectedly',
      String(normalizationError),
    ])
  }
}

function stringField(
  record: CruxAttributes | undefined,
  key: string,
): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function captureContextValue(
  context: ObservabilityContext,
  spanStack: readonly CruxSpanId[],
  currentSpanId?: CruxSpanId,
): CapturedObservabilityContext {
  return {
    runId: context.runId,
    segmentId: context.segmentId,
    traceId: context.traceId,
    ...(context.startedAtMs !== undefined
      ? { startedAtMs: context.startedAtMs }
      : {}),
    ...(context.correlators !== undefined
      ? { correlators: context.correlators }
      : {}),
    ...(context.deployment !== undefined
      ? { deployment: context.deployment }
      : {}),
    spanStack: [...spanStack],
    ...(currentSpanId ? { currentSpanId } : {}),
  }
}

export function configureObservability(
  options: ConfigureObservabilityOptions,
): () => void {
  const nextDeploymentIdentity = Object.hasOwn(options, 'identity')
    ? cloneDeploymentIdentity(options.identity)
    : deploymentIdentity
  const layer: ObservabilityConfigurationLayer = {
    token: nextConfigurationToken + 1,
    parentToken: activeConfigurationToken,
    previousTransport: deliveryEngine.currentTransport(),
    previousDeliveryOptions: deliveryEngine.deliveryOptions(),
    previousDefaultCorrelators: defaultCorrelators,
    previousDeploymentIdentity: deploymentIdentity,
  }
  nextConfigurationToken = layer.token
  configurationParents.set(layer.token, layer.parentToken)
  activeConfigurationToken = layer.token
  if (Object.hasOwn(options, 'transport')) {
    deliveryEngine.setTransport(options.transport)
  }
  if (Object.hasOwn(options, 'delivery')) {
    deliveryEngine.configureDelivery(options.delivery)
  }
  if (Object.hasOwn(options, 'defaultCorrelators')) {
    defaultCorrelators = mergeCruxCorrelators(
      undefined,
      options.defaultCorrelators,
    )
  }
  if (Object.hasOwn(options, 'identity')) {
    deploymentIdentity = nextDeploymentIdentity
  }
  let restored = false
  return () => {
    if (restored) return
    restored = true
    if (!isActiveConfigurationLayer(layer.token)) {
      deleteConfigurationLayerAndDescendants(layer.token)
      return
    }

    activeConfigurationToken = layer.parentToken
    deleteConfigurationLayerAndDescendants(layer.token)
    deliveryEngine.setTransport(layer.previousTransport)
    deliveryEngine.configureDelivery(layer.previousDeliveryOptions)
    defaultCorrelators = layer.previousDefaultCorrelators
    deploymentIdentity = layer.previousDeploymentIdentity
  }
}

function cloneDeploymentIdentity(
  identity: CruxDeploymentIdentity | undefined,
): CruxDeploymentIdentity | undefined {
  if (identity === undefined) return undefined
  return Object.freeze({ ...CruxDeploymentIdentitySchema.parse(identity) })
}

/**
 * Run a callback with correlators attached to every observability record.
 *
 * Scopes may be nested. Inner scalar fields override outer scalar fields, and
 * metadata is merged by key with inner values winning. Metadata values are
 * projected onto record attributes as `meta.<key>` strings capped at 200
 * characters.
 *
 * @param correlators - Session, user, and flat metadata identifiers.
 * @param fn - Work to run while the correlators are active.
 * @returns The callback result.
 */
export function propagateAttributes<T>(
  correlators: CruxCorrelators,
  fn: () => Promise<T>,
): Promise<T>
export function propagateAttributes<T>(
  correlators: CruxCorrelators,
  fn: () => T,
): T
export function propagateAttributes<T>(
  correlators: CruxCorrelators,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return withCruxCorrelators(correlators, fn)
}

function isActiveConfigurationLayer(token: number): boolean {
  for (let currentToken = activeConfigurationToken; currentToken !== 0; ) {
    if (currentToken === token) return true
    currentToken = configurationParents.get(currentToken) ?? 0
  }
  return false
}

function deleteConfigurationLayerAndDescendants(token: number): void {
  const tokensToDelete = new Set<number>([token])
  for (const childToken of [...configurationParents.keys()]) {
    if (isDescendantConfigurationLayer(childToken, token)) {
      tokensToDelete.add(childToken)
    }
  }
  for (const tokenToDelete of tokensToDelete)
    configurationParents.delete(tokenToDelete)
}

function isDescendantConfigurationLayer(
  candidateToken: number,
  ancestorToken: number,
): boolean {
  for (
    let currentToken = configurationParents.get(candidateToken) ?? 0;
    currentToken !== 0;
  ) {
    if (currentToken === ancestorToken) return true
    currentToken = configurationParents.get(currentToken) ?? 0
  }
  return false
}

export function setObservabilityTransport(
  transport: CruxObservabilityTransport | undefined,
  options?: ObservabilityDeliveryOptions,
): () => void {
  return configureObservability({ transport, delivery: options })
}

/**
 * Read the currently configured observability transport.
 *
 * Returns the active transport for diagnostics and adapter composition. Prefer
 * {@link teeObservabilityTransport} when a feature needs to fan records out to
 * an additional sink while preserving an already configured transport.
 *
 * @see {@link teeObservabilityTransport}
 */
export function currentObservabilityTransport():
  | CruxObservabilityTransport
  | undefined {
  return deliveryEngine.currentTransport()
}

export function resetObservabilityRuntime(): void {
  deliveryEngine.reset()
  resetObservabilitySubscribers()
  activeConfigurationToken = 0
  nextConfigurationToken = 0
  configurationParents.clear()
  invalidRecords = 0
  redactedRecords = 0
  contextlessRecords = 0
  warnedAboutInvalidRecord = false
  warnedAboutRedactedRecord = false
  warnedAboutContextlessRecord = false
  endedRunStatuses.clear()
  runDeploymentIdentities.clear()
  recordSequencer.reset()
  defaultCorrelators = undefined
  deploymentIdentity = undefined
  telemetryFlushFailures = 0
}

export function observabilityDeliveryErrors(): readonly unknown[] {
  return deliveryEngine.errors()
}

export function observabilityDiagnostics(): ObservabilityDiagnostics {
  const deliveryDiagnostics = deliveryEngine.diagnostics()
  return {
    pendingDeliveries: deliveryDiagnostics.pendingDeliveries,
    queuedRecords: deliveryDiagnostics.queuedRecords,
    queuedBytes: deliveryDiagnostics.queuedBytes,
    droppedRecords: deliveryDiagnostics.droppedRecords,
    deliveryErrorCount: deliveryDiagnostics.deliveryErrorCount,
    invalidRecords,
    redactedRecords,
    contextlessRecords,
    deliveryErrors: deliveryDiagnostics.deliveryErrors,
    acceptedRecords: deliveryDiagnostics.acceptedRecords,
    retriedRecords: deliveryDiagnostics.retriedRecords,
    permanentlyRejectedRecords:
      deliveryDiagnostics.permanentlyRejectedRecords,
    overflowDroppedRecords: deliveryDiagnostics.overflowDroppedRecords,
    overflowDroppedBytes: deliveryDiagnostics.overflowDroppedBytes,
    deadlineDroppedRecords: deliveryDiagnostics.deadlineDroppedRecords,
    reconfiguredDroppedRecords: deliveryDiagnostics.reconfiguredDroppedRecords,
    reconfiguredRemainingRecords: deliveryDiagnostics.reconfiguredRemainingRecords,
    reconfiguredRemainingBytes: deliveryDiagnostics.reconfiguredRemainingBytes,
    reconfiguredTrackedDeliveries: deliveryDiagnostics.reconfiguredTrackedDeliveries,
    subscriberErrors: observabilitySubscriberErrorCount(),
  }
}

export const observe = {
  openRun(options: ObserveRunOptions): OpenObservedRun {
    const runId = createCruxRunId()
    const traceId = options.traceId ?? createCruxTraceId()
    const segmentId = createCruxSegmentId()
    const startedAtMs = Date.now()
    const context: ObservabilityContext = {
      runId,
      traceId,
      segmentId,
      startedAtMs,
      spanStack: [],
      correlators: effectiveCorrelators(),
      deployment: cloneDeploymentIdentity(deploymentIdentity),
    }
    rememberRunDeployment(runId, context.deployment)
    let closed = false
    const continuation = createPropagationCarrier({
      runId,
      traceId,
      previousSegmentId: segmentId,
      correlators: context.correlators,
      deployment: context.deployment,
    })

    emitObserved(
      () => ({
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: createCruxRecordId(),
        type: 'run:start',
        runId,
        segmentId,
        traceId,
        name: options.name,
        rootPrimitive: options.rootPrimitive,
        startedAt: now(),
        status: 'running',
        ...(options.attributes ? { attributes: options.attributes } : {}),
        ...(options.definitionRefs && options.definitionRefs.length > 0
          ? { definitionRefs: options.definitionRefs }
          : {}),
      }),
      context.correlators ?? null,
    )

    const finish = (finishOptions: EndObservedRunOptions = {}): void => {
      if (closed) return
      closed = true
      const status =
        finishOptions.status ?? (finishOptions.error ? 'error' : 'ok')
      if (!rememberEndedRun(runId, status)) return
      emitObserved(
        () => ({
          schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
          recordId: createCruxRecordId(),
          type: 'run:end',
          runId,
          segmentId,
          traceId,
          endedAt: now(),
          durationMs: durationSince(startedAtMs),
          status,
          ...(finishOptions.metrics ? { metrics: finishOptions.metrics } : {}),
          ...(finishOptions.error !== undefined
            ? {
                error: observedErrorSummary(
                  finishOptions.error,
                  errorContext(finishOptions.attributes),
                ),
              }
            : {}),
          ...(finishOptions.attributes
            ? { attributes: finishOptions.attributes }
            : {}),
        }),
        context.correlators ?? null,
      )
    }

    return {
      runId,
      traceId,
      segmentId,
      captureContext(): CapturedObservabilityContext {
        return captureContextValue(context, [])
      },
      captureContinuation(): CruxPropagationCarrier {
        return continuation
      },
      withContext<T>(fn: () => T | Promise<T>): T | Promise<T> {
        return withContext(context, fn)
      },
      suspend(options: SuspendObservedRunOptions): CruxPropagationCarrier {
        if (!options.reason) throw new TypeError('A suspension reason is required')
        if (closed) return continuation
        closed = true
        emitObserved(
          () => ({
            schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
            recordId: createCruxRecordId(),
            type: 'run:suspend',
            runId,
            segmentId,
            traceId,
            suspendedAt: now(),
            reason: options.reason,
            ...(options.attributes ? { attributes: options.attributes } : {}),
          }),
          context.correlators ?? null,
        )
        return continuation
      },
      end(options?: EndObservedRunOptions): void {
        finish(options)
      },
      error(
        error: unknown,
        options?: Omit<EndObservedRunOptions, 'status' | 'error'>,
      ): void {
        finish({ ...options, status: 'error', error })
      },
    }
  },

  resumeRun(
    carrier: CruxPropagationCarrier,
    options: ResumeObservedRunOptions,
  ): OpenObservedRun {
    if (!options.reason) throw new TypeError('A resume reason is required')
    const identity = continuationIdentity(carrier)
    if (endedRunStatuses.has(identity.runId)) {
      throw new Error('Cannot resume a terminal observed run')
    }
    const segmentId = createCruxSegmentId()
    const startedAtMs = Date.now()
    const context: ObservabilityContext = {
      runId: identity.runId,
      traceId: identity.traceId,
      segmentId,
      startedAtMs,
      spanStack: [],
      correlators: effectiveCorrelators(),
      deployment: cloneDeploymentIdentity(identity.deployment),
    }
    rememberRunDeployment(identity.runId, context.deployment)
    let closed = false
    const continuation = createPropagationCarrier({
      runId: identity.runId,
      traceId: identity.traceId,
      previousSegmentId: segmentId,
      correlators: context.correlators,
      deployment: context.deployment,
    })
    const resumeAttributes = resumeAttributesFor(carrier, options.attributes)

    emitObserved(
      () => ({
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: createCruxRecordId(),
        type: 'run:resume',
        runId: identity.runId,
        segmentId,
        traceId: identity.traceId,
        resumedAt: now(),
        reason: options.reason,
        ...(identity.previousSegmentId
          ? { previousSegmentId: identity.previousSegmentId }
          : {}),
        ...(resumeAttributes ? { attributes: resumeAttributes } : {}),
      }),
      context.correlators ?? null,
    )

    const finish = (finishOptions: EndObservedRunOptions = {}): void => {
      if (closed) return
      closed = true
      const status = finishOptions.status ?? (finishOptions.error ? 'error' : 'ok')
      if (!rememberEndedRun(identity.runId, status)) return
      emitObserved(
        () => ({
          schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
          recordId: createCruxRecordId(),
          type: 'run:end',
          runId: identity.runId,
          segmentId,
          traceId: identity.traceId,
          endedAt: now(),
          durationMs: durationSince(startedAtMs),
          status,
          ...(finishOptions.metrics ? { metrics: finishOptions.metrics } : {}),
          ...(finishOptions.error !== undefined
            ? { error: observedErrorSummary(finishOptions.error, errorContext(finishOptions.attributes)) }
            : {}),
          ...(finishOptions.attributes ? { attributes: finishOptions.attributes } : {}),
        }),
        context.correlators ?? null,
      )
    }

    return {
      runId: identity.runId,
      traceId: identity.traceId,
      segmentId,
      captureContext: () => captureContextValue(context, []),
      captureContinuation: () => continuation,
      withContext: <T>(fn: () => T | Promise<T>) => withContext(context, fn),
      suspend(suspendOptions: SuspendObservedRunOptions): CruxPropagationCarrier {
        if (!suspendOptions.reason) throw new TypeError('A suspension reason is required')
        if (closed) return continuation
        closed = true
        emitObserved(
          () => ({
            schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
            recordId: createCruxRecordId(),
            type: 'run:suspend',
            runId: identity.runId,
            segmentId,
            traceId: identity.traceId,
            suspendedAt: now(),
            reason: suspendOptions.reason,
            ...(suspendOptions.attributes ? { attributes: suspendOptions.attributes } : {}),
          }),
          context.correlators ?? null,
        )
        return continuation
      },
      end: finish,
      error(error, finishOptions): void {
        finish({ ...finishOptions, status: 'error', error })
      },
    }
  },

  async run<T>(
    options: ObserveRunOptions,
    fn: () => T | Promise<T>,
  ): Promise<T> {
    const runId = createCruxRunId()
    const traceId = options.traceId ?? createCruxTraceId()
    const segmentId = createCruxSegmentId()
    const startedAtMs = Date.now()
    const context: ObservabilityContext = {
      runId,
      traceId,
      segmentId,
      startedAtMs,
      spanStack: [],
      correlators: effectiveCorrelators(),
      deployment: cloneDeploymentIdentity(deploymentIdentity),
    }
    rememberRunDeployment(runId, context.deployment)

    emitObserved(
      () => ({
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: createCruxRecordId(),
        type: 'run:start',
        runId,
        segmentId,
        traceId,
        name: options.name,
        rootPrimitive: options.rootPrimitive,
        startedAt: now(),
        status: 'running',
        ...(options.attributes ? { attributes: options.attributes } : {}),
        ...(options.definitionRefs && options.definitionRefs.length > 0
          ? { definitionRefs: options.definitionRefs }
          : {}),
      }),
      context.correlators ?? null,
    )

    try {
      const result = await withContext(context, fn)
      if (!rememberEndedRun(runId, 'ok')) return result
      emitObserved(
        () => ({
          schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
          recordId: createCruxRecordId(),
          type: 'run:end',
          runId,
          segmentId,
          traceId,
          endedAt: now(),
          durationMs: durationSince(startedAtMs),
          status: 'ok',
        }),
        context.correlators ?? null,
      )
      return result
    } catch (error) {
      if (!rememberEndedRun(runId, 'error')) throw error
      emitObserved(
        () => ({
          schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
          recordId: createCruxRecordId(),
          type: 'run:end',
          runId,
          segmentId,
          traceId,
          endedAt: now(),
          durationMs: durationSince(startedAtMs),
          status: 'error',
          error: observedErrorSummary(error, errorContext(options.attributes)),
        }),
        context.correlators ?? null,
      )
      throw error
    }
  },

  async span<P extends CruxPrimitiveName, T>(
    options: ObserveSpanOptions<P>,
    fn: () => T | Promise<T>,
  ): Promise<T> {
    const context = currentContext()
    if (!context) {
      if (options.implicitRun === false) return await fn()
      return await observe.run(
        {
          name: options.name,
          rootPrimitive: options.primitive,
          attributes: options.attributes,
        },
        // Re-entering span() relies on the run having established a context.
        // When context propagation is unavailable (no AsyncLocalStorage), the
        // re-entry would land in this same no-context branch forever — degrade
        // to executing the body without a span instead of recursing.
        () => (currentContext() ? observe.span(options, fn) : fn()),
      )
    }

    const spanId = createCruxSpanId()
    const parentSpanId = context.spanStack[context.spanStack.length - 1] ?? null
    const nextContext: ObservabilityContext = {
      ...context,
      spanStack: [...context.spanStack, spanId],
    }
    const startedAtMs = Date.now()

    emitObserved(
      () => ({
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: createCruxRecordId(),
        type: 'span:start',
        runId: context.runId,
        segmentId: context.segmentId,
        traceId: context.traceId,
        spanId,
        parentSpanId,
        family: CRUX_PRIMITIVE_FAMILY_BY_NAME[options.primitive],
        primitive: options.primitive,
        name: options.name,
        startedAt: now(),
        status: 'running',
        ...(options.attributes ? { attributes: options.attributes } : {}),
        ...(options.definitionRefs && options.definitionRefs.length > 0
          ? { definitionRefs: options.definitionRefs }
          : {}),
      }),
      context.correlators ?? null,
    )

    try {
      const result = await withContext(nextContext, fn)
      emitObserved(
        () => ({
          schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
          recordId: createCruxRecordId(),
          type: 'span:end',
          runId: context.runId,
          segmentId: context.segmentId,
          traceId: context.traceId,
          spanId,
          endedAt: now(),
          durationMs: durationSince(startedAtMs),
          status: 'ok',
        }),
        nextContext.correlators ?? null,
      )
      return result
    } catch (error) {
      emitObservedErrorEvidence(nextContext, spanId, error, options.attributes)
      emitObserved(
        () => ({
          schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
          recordId: createCruxRecordId(),
          type: 'span:end',
          runId: context.runId,
          segmentId: context.segmentId,
          traceId: context.traceId,
          spanId,
          endedAt: now(),
          durationMs: durationSince(startedAtMs),
          status: 'error',
          error: observedErrorSummary(error, errorContext(options.attributes)),
          ...(options.attributes ? { attributes: options.attributes } : {}),
        }),
        nextContext.correlators ?? null,
      )
      throw error
    }
  },

  openSpan<P extends CruxPrimitiveName>(
    options: ObserveSpanOptions<P>,
  ): OpenObservedSpan {
    let context = currentContext()
    let openedImplicitRun = false
    let implicitRunStartedAtMs = 0
    if (!context) {
      if (options.implicitRun === false) {
        const runId = createCruxRunId()
        const traceId = createCruxTraceId()
        const segmentId = createCruxSegmentId()
        const spanId = createCruxSpanId()
        return {
          runId,
          traceId,
          segmentId,
          spanId,
          parentSpanId: null,
          withContext<T>(fn: () => T | Promise<T>): T | Promise<T> {
            return fn()
          },
          setAttributes(): void {},
          end(): void {},
          error(): void {},
        }
      }
      openedImplicitRun = true
      implicitRunStartedAtMs = Date.now()
      const implicitContext: ObservabilityContext = {
        runId: createCruxRunId(),
        traceId: createCruxTraceId(),
        segmentId: createCruxSegmentId(),
        startedAtMs: implicitRunStartedAtMs,
        spanStack: [],
        correlators: effectiveCorrelators(),
        deployment: cloneDeploymentIdentity(deploymentIdentity),
      }
      rememberRunDeployment(implicitContext.runId, implicitContext.deployment)
      context = implicitContext
      emitObserved(
        () => ({
          schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
          recordId: createCruxRecordId(),
          type: 'run:start',
          runId: implicitContext.runId,
          segmentId: implicitContext.segmentId,
          traceId: implicitContext.traceId,
          name: options.name,
          rootPrimitive: options.primitive,
          startedAt: now(),
          status: 'running',
          ...(options.attributes ? { attributes: options.attributes } : {}),
        }),
        implicitContext.correlators ?? null,
      )
    }

    const spanId = options.spanId ?? createCruxSpanId()
    const parentSpanId = context.spanStack[context.spanStack.length - 1] ?? null
    const spanContext: ObservabilityContext = {
      ...context,
      spanStack: [...context.spanStack, spanId],
    }
    const startedAtMs = Date.now()
    let ended = false
    let accumulatedAttributes: CruxAttributes | undefined

    emitObserved(
      () => ({
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: createCruxRecordId(),
        type: 'span:start',
        runId: context.runId,
        segmentId: context.segmentId,
        traceId: context.traceId,
        spanId,
        parentSpanId,
        family: CRUX_PRIMITIVE_FAMILY_BY_NAME[options.primitive],
        primitive: options.primitive,
        name: options.name,
        startedAt: now(),
        status: 'running',
        ...(options.attributes ? { attributes: options.attributes } : {}),
        ...(options.definitionRefs && options.definitionRefs.length > 0
          ? { definitionRefs: options.definitionRefs }
          : {}),
      }),
      context.correlators ?? null,
    )

    const mergeSpanAttributes = (
      finishAttributes?: CruxAttributes,
    ): CruxAttributes | undefined => {
      if (!options.attributes && !accumulatedAttributes && !finishAttributes)
        return undefined
      return {
        ...(options.attributes ?? {}),
        ...(accumulatedAttributes ?? {}),
        ...(finishAttributes ?? {}),
      }
    }

    const finish = (finishOptions: EndObservedSpanOptions = {}): void => {
      if (ended) return
      ended = true
      const status =
        finishOptions.status ?? (finishOptions.error ? 'error' : 'ok')
      const attributes = mergeSpanAttributes(finishOptions.attributes)
      if (finishOptions.error !== undefined) {
        emitObservedErrorEvidence(
          spanContext,
          spanId,
          finishOptions.error,
          attributes,
        )
      }
      emitObserved(
        () => ({
          schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
          recordId: createCruxRecordId(),
          type: 'span:end',
          runId: spanContext.runId,
          segmentId: spanContext.segmentId,
          traceId: spanContext.traceId,
          spanId,
          endedAt: now(),
          durationMs: durationSince(startedAtMs),
          status,
          ...(finishOptions.metrics ? { metrics: finishOptions.metrics } : {}),
          ...(finishOptions.error !== undefined
            ? {
                error: observedErrorSummary(
                  finishOptions.error,
                  errorContext(attributes),
                ),
              }
            : {}),
          ...(attributes ? { attributes } : {}),
        }),
        spanContext.correlators ?? null,
      )
      if (openedImplicitRun) {
        const runStatus: EndedRunStatus = status === 'skipped' ? 'ok' : status
        if (!rememberEndedRun(spanContext.runId, runStatus)) return
        emitObserved(
          () => ({
            schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
            recordId: createCruxRecordId(),
            type: 'run:end',
            runId: spanContext.runId,
            segmentId: spanContext.segmentId,
            traceId: spanContext.traceId,
            endedAt: now(),
            durationMs: durationSince(implicitRunStartedAtMs),
            status: runStatus,
            ...(finishOptions.metrics
              ? { metrics: finishOptions.metrics }
              : {}),
            ...(finishOptions.error !== undefined
              ? {
                  error: observedErrorSummary(
                    finishOptions.error,
                    errorContext(attributes),
                  ),
                }
              : {}),
          }),
          spanContext.correlators ?? null,
        )
      }
    }

    return {
      runId: spanContext.runId,
      traceId: spanContext.traceId,
      segmentId: spanContext.segmentId,
      spanId,
      parentSpanId,
      withContext<T>(fn: () => T | Promise<T>): T | Promise<T> {
        return withContext(spanContext, fn)
      },
      setAttributes(attributes: CruxAttributes): void {
        accumulatedAttributes = {
          ...(accumulatedAttributes ?? {}),
          ...attributes,
        }
      },
      end(options?: EndObservedSpanOptions): void {
        finish(options)
      },
      error(error: unknown, attributes?: CruxAttributes): void {
        finish({ status: 'error', error, attributes })
      },
    }
  },

  event(options: ObserveEventOptions): void {
    if (shouldQuarantineQualityObservabilityWrite()) return
    const context = currentContext()
    const spanId = context?.spanStack[context.spanStack.length - 1]
    if (!context) {
      recordContextlessRecord('event')
      return
    }
    if (!spanId) return

    emitObserved(
      () => ({
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: createCruxRecordId(),
        type: 'span:event',
        runId: context.runId,
        segmentId: context.segmentId,
        traceId: context.traceId,
        spanId,
        eventId: createCruxSpanEventId(),
        name: options.name,
        timestamp: now(),
        ...(options.attributes ? { attributes: options.attributes } : {}),
      }),
      context.correlators ?? null,
    )
  },

  artifact(options: ObserveArtifactOptions): CruxArtifactId | undefined {
    if (shouldQuarantineQualityObservabilityWrite()) return undefined
    const context = currentContext()
    if (!context) {
      recordContextlessRecord('artifact')
      return undefined
    }

    const artifactId = options.artifactId ?? createCruxArtifactId()
    emitObserved(() => {
      const spanId = context.spanStack[context.spanStack.length - 1]
      return {
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: createCruxRecordId(),
        type: 'artifact',
        runId: context.runId,
        segmentId: context.segmentId,
        traceId: context.traceId,
        artifactId,
        ...(spanId ? { spanId } : {}),
        kind: options.kind,
        createdAt: now(),
        contentType: options.contentType,
        encoding: options.encoding,
        ...(options.sizeBytes !== undefined
          ? { sizeBytes: options.sizeBytes }
          : {}),
        ...(options.hash ? { hash: options.hash } : {}),
        ...(options.preview !== undefined ? { preview: options.preview } : {}),
        ...(options.uri ? { uri: options.uri } : {}),
        ...(options.attributes ? { attributes: options.attributes } : {}),
      }
    }, context.correlators ?? null)
    return artifactId
  },

  edge(options: ObserveEdgeOptions): void {
    if (shouldQuarantineQualityObservabilityWrite()) return
    const context = currentContext()
    if (!context) {
      recordContextlessRecord('edge')
      return
    }

    emitObserved(
      () => ({
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: createCruxRecordId(),
        type: 'edge',
        runId: context.runId,
        segmentId: context.segmentId,
        traceId: context.traceId,
        edgeId: createCruxEdgeId(),
        edgeType: options.edgeType,
        from: options.from,
        to: options.to,
        createdAt: now(),
        ...(options.attributes ? { attributes: options.attributes } : {}),
      }),
      context.correlators ?? null,
    )
  },

  captureContext(): CapturedObservabilityContext | undefined {
    const context = currentContext()
    if (!context) return undefined
    const currentSpanId = context.spanStack[context.spanStack.length - 1]
    return captureContextValue(context, context.spanStack, currentSpanId)
  },

  withContext<T>(
    context: CapturedObservabilityContext | undefined,
    fn: () => T | Promise<T>,
  ): T | Promise<T> {
    if (!context) return fn()
    return withContext(
      {
        runId: context.runId,
        traceId: context.traceId,
        segmentId: context.segmentId,
        startedAtMs: context.startedAtMs,
        correlators: context.correlators,
        deployment: context.deployment,
        spanStack: [...context.spanStack],
      },
      fn,
    )
  },

  /**
   * Bind a host lifecycle (defer/deadline) to `fn`'s call tree.
   *
   * Scopes delivery's defer/deadline usage to this invocation instead of the
   * process-wide `setObservabilityTransport(transport, { hostLifecycle })`
   * option, so concurrent physical invocations never see each other's host
   * lifecycle. Requires AsyncLocalStorage for async `fn`; falls back to a
   * synchronous-only scope where it is unavailable.
   */
  withHostLifecycle<T>(lifecycle: CruxHostLifecycle, fn: () => T): T {
    return runWithHostLifecycle(lifecycle, fn)
  },

  async flush(
    options: ObservabilityFlushOptions = {},
  ): Promise<ObservabilityFlushResult> {
    const [result] = await Promise.all([
      deliveryEngine.flush(options),
      runTelemetryFlushHook(options),
    ])
    return result
  },

  async shutdown(
    options: ObservabilityFlushOptions = {},
  ): Promise<ObservabilityFlushResult> {
    const [result] = await Promise.all([
      deliveryEngine.shutdown(options),
      runTelemetryFlushHook(options),
    ])
    return result
  },
}

let telemetryFlushFailures = 0

/** Total non-throwing telemetry flush hook failures observed since the last reset. */
export function observabilityTelemetryFlushFailures(): number {
  return telemetryFlushFailures
}

/**
 * Bound the telemetry flush hook's wait to the smaller of an explicit
 * `timeoutMs` and the active host lifecycle's remaining deadline, mirroring
 * the delivery engine's own deadline combination in `drainDeliveryState`.
 */
function telemetryFlushDeadlineMs(options: ObservabilityFlushOptions): number | undefined {
  const hostRemainingMs = remainingHostDeadlineMs(activeHostLifecycle())
  const explicitMs = options.timeoutMs === undefined ? undefined : Math.max(0, options.timeoutMs)
  if (hostRemainingMs === undefined) return explicitMs
  if (explicitMs === undefined) return hostRemainingMs
  return Math.min(explicitMs, hostRemainingMs)
}

/** Run the installed telemetry flush hook, if any. Never throws through app work. */
async function runTelemetryFlushHook(options: ObservabilityFlushOptions): Promise<void> {
  const hook = getHooks().telemetryFlushHook
  if (!hook) return
  try {
    const result = await hook({ deadlineMs: telemetryFlushDeadlineMs(options) })
    if (!result?.ok) telemetryFlushFailures += 1
  } catch {
    telemetryFlushFailures += 1
  }
}

function rememberEndedRun(runId: CruxRunId, status: EndedRunStatus): boolean {
  const previousStatus = endedRunStatuses.get(runId)
  if (previousStatus) return false

  endedRunStatuses.set(runId, status)
  if (endedRunStatuses.size <= maxEndedRunIds) return true

  const oldestRunId = endedRunStatuses.keys().next().value
  if (oldestRunId) {
    endedRunStatuses.delete(oldestRunId)
    runDeploymentIdentities.delete(oldestRunId)
  }
  return true
}

function rememberRunDeployment(
  runId: CruxRunId,
  identity: CruxDeploymentIdentity | undefined,
): void {
  if (runDeploymentIdentities.has(runId)) {
    const current = runDeploymentIdentities.get(runId) ?? undefined
    if (!sameDeploymentIdentity({ deployment: current }, { deployment: identity })) {
      throw new Error('Cannot change an observed run deployment identity')
    }
    return
  }
  runDeploymentIdentities.set(
    runId,
    identity ? cloneDeploymentIdentity(identity)! : null,
  )
}

function recordContextlessRecord(kind: 'event' | 'artifact' | 'edge'): void {
  contextlessRecords += 1
  if (warnedAboutContextlessRecord) return
  if (!shouldWarnAboutRuntimeLimitations()) return
  warnedAboutContextlessRecord = true
  console.warn(
    `[crux] observability ${kind} skipped because no active observability context is available.`,
  )
}
