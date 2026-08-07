import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { STORE_DOC_COMPONENT_SPEC } from '../store-doc/manifest'

export default defineSchema({
  [STORE_DOC_COMPONENT_SPEC.table]: defineTable({
    key: v.string(),
    content: v.string(),
    metadata: v.optional(v.any()),
    embedding: v.optional(v.array(v.float64())),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index(STORE_DOC_COMPONENT_SPEC.indexes.byKey, [
    STORE_DOC_COMPONENT_SPEC.fields.key,
  ]),

  swarmRuns: defineTable({
    swarmRunId: v.string(),
    currentAgentId: v.string(),
    handoffPath: v.array(v.string()),
    handoffCount: v.number(),
    currentInput: v.any(),
    originalInput: v.any(),
    status: v.union(
      v.literal('running'),
      v.literal('completed'),
      v.literal('error'),
    ),
    output: v.optional(v.any()),
    error: v.optional(v.string()),
    flowId: v.string(),
    sessionId: v.optional(v.string()),
    observability: v.optional(v.any()),
    maxHandoffs: v.number(),
    history: v.union(v.literal('transfer-only'), v.literal('accumulate')),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_run_id', ['swarmRunId'])
    .index('by_status', ['status'])
    .index('by_session', ['sessionId']),

  runtimeWork: defineTable({
    workId: v.string(),
    namespace: v.string(),
    work: v.any(),
    /** Denormalized work.kind for targeted listWork (Agent ingress settlement). */
    workKind: v.optional(v.string()),
    /** Denormalized work.sessionId for Session-scoped listWork filters. */
    workSessionId: v.optional(v.string()),
    targetId: v.string(),
    status: v.string(),
    attempt: v.number(),
    maxAttempts: v.number(),
    notBefore: v.optional(v.number()),
    idempotencyKey: v.string(),
    idleScope: v.optional(v.string()),
    leaseToken: v.optional(v.string()),
    lastError: v.optional(v.any()),
    resultRef: v.optional(v.any()),
    application: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_work_id', ['workId'])
    .index('by_namespace_status_updated', ['namespace', 'status', 'updatedAt'])
    .index('by_status_updated', ['status', 'updatedAt'])
    .index('by_namespace_status_kind_session_updated', [
      'namespace',
      'status',
      'workKind',
      'workSessionId',
      'updatedAt',
    ]),

  runtimeSessions: defineTable({
    schemaVersion: v.literal(1),
    namespace: v.string(),
    sessionId: v.string(),
    keyHash: v.string(),
    targetId: v.string(),
    targetKind: v.union(v.literal('agent'), v.literal('flow')),
    threadId: v.string(),
    model: v.optional(v.any()),
    definition: v.optional(v.any()),
    state: v.union(
      v.literal('prepared'),
      v.literal('ready'),
      v.literal('closing'),
      v.literal('closed'),
      v.literal('killed'),
      v.literal('deleted'),
    ),
    acceptedCursor: v.number(),
    processedCursor: v.optional(v.number()),
    pendingInputs: v.number(),
    pendingWork: v.number(),
    blockedWork: v.number(),
    statistics: v.any(),
    wakePending: v.boolean(),
    activation: v.optional(v.any()),
    activationWorkId: v.optional(v.string()),
    parentSessionId: v.optional(v.string()),
    forkedFrom: v.optional(
      v.object({
        sessionId: v.string(),
        cursor: v.number(),
        threadRevision: v.string(),
      }),
    ),
    fencedWorkId: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index('by_namespace_key', ['namespace', 'keyHash'])
    .index('by_namespace_session', ['namespace', 'sessionId'])
    .index('by_namespace_updated', ['namespace', 'updatedAt'])
    .index('by_namespace_activation_work', ['namespace', 'activationWorkId'])
    .index('by_namespace_parent', ['namespace', 'parentSessionId']),

  runtimeSessionInputs: defineTable({
    schemaVersion: v.literal(1),
    namespace: v.string(),
    sessionId: v.string(),
    inputId: v.string(),
    cursor: v.number(),
    input: v.any(),
    acceptedAt: v.string(),
    work: v.optional(v.any()),
    workId: v.optional(v.string()),
    delivery: v.optional(v.any()),
    preparedExecution: v.optional(v.any()),
    preparedResultLocation: v.optional(v.string()),
  })
    .index('by_namespace_input', ['namespace', 'inputId'])
    .index('by_session_cursor', ['namespace', 'sessionId', 'cursor'])
    .index('by_session_work_cursor', ['namespace', 'sessionId', 'workId', 'cursor'])
    .index('by_prepared_result', ['namespace', 'preparedResultLocation']),

  runtimeSessionSubscriptions: defineTable({
    schemaVersion: v.literal(1),
    namespace: v.string(),
    sessionId: v.string(),
    subscriptionId: v.string(),
    signalId: v.string(),
    match: v.optional(v.any()),
    matchKey: v.string(),
    state: v.union(v.literal('active'), v.literal('unsubscribed')),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index('by_namespace_subscription', ['namespace', 'subscriptionId'])
    .index('by_session_state', ['namespace', 'sessionId', 'state'])
    .index('by_signal_state', ['namespace', 'signalId', 'state'])
    .index('by_session_signal_match', [
      'namespace',
      'sessionId',
      'signalId',
      'matchKey',
    ]),

  runtimeResults: defineTable({
    namespace: v.string(),
    sha256: v.string(),
    size: v.number(),
    mediaType: v.string(),
    location: v.string(),
    chunkCount: v.number(),
    createdAt: v.number(),
  })
    .index('by_location', ['location'])
    .index('by_namespace_created', ['namespace', 'createdAt']),

  runtimeResultChunks: defineTable({
    location: v.string(),
    index: v.number(),
    content: v.string(),
  }).index('by_location_index', ['location', 'index']),

  runtimeSnapshots: defineTable({
    flowId: v.string(),
    workId: v.string(),
    targetId: v.string(),
    definition: v.optional(
      v.object({
        targetId: v.string(),
        definitionId: v.string(),
        fingerprint: v.string(),
        manifestHash: v.string(),
      }),
    ),
    resultObligation: v.optional(v.object({ kind: v.literal('required') })),
    namespace: v.string(),
    status: v.string(),
    effects: v.optional(
      v.object({
        kind: v.literal('effect.scope'),
        id: v.string(),
        runId: v.string(),
      }),
    ),
    input: v.any(),
    inputDigest: v.optional(v.string()),
    continuation: v.optional(v.any()),
    completedSteps: v.any(),
    fingerprint: v.array(v.string()),
    pendingSuspends: v.any(),
    deliveredSuspends: v.optional(v.any()),
    scheduledWork: v.optional(v.any()),
    updatedAt: v.number(),
  })
    .index('by_flow', ['namespace', 'flowId'])
    .index('by_namespace_status_updated', ['namespace', 'status', 'updatedAt'])
    .index('by_status_updated', ['status', 'updatedAt']),

  runtimeEvents: defineTable({
    eventId: v.union(v.number(), v.string()),
    eventKey: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    namespace: v.string(),
    name: v.string(),
    payload: v.any(),
    appendedAt: v.number(),
  })
    .index('by_namespace_event_id', ['namespace', 'eventId'])
    .index('by_namespace_appended', ['namespace', 'appendedAt'])
    .index('by_appended', ['appendedAt'])
    .index('by_namespace_event_key', ['namespace', 'eventKey'])
    .index('by_namespace_idempotency_key', ['namespace', 'idempotencyKey'])
    .index('by_namespace_name', ['namespace', 'name']),

  runtimeWaiters: defineTable({
    waiterId: v.string(),
    namespace: v.string(),
    eventName: v.string(),
    match: v.any(),
    workId: v.optional(v.string()),
    work: v.any(),
    timeoutAt: v.optional(v.number()),
    timerId: v.optional(v.string()),
    state: v.string(),
    settledAt: v.optional(v.number()),
  })
    .index('by_waiter_id', ['waiterId'])
    .index('by_namespace_event_state', ['namespace', 'eventName', 'state'])
    .index('by_work', ['workId'])
    .index('by_namespace_state_timeout', ['namespace', 'state', 'timeoutAt'])
    .index('by_namespace_state_settled', ['namespace', 'state', 'settledAt'])
    .index('by_state_settled', ['state', 'settledAt']),

  runtimeTimers: defineTable({
    timerId: v.string(),
    namespace: v.string(),
    fireAt: v.number(),
    workId: v.optional(v.string()),
    waiterId: v.optional(v.string()),
    idleScope: v.optional(v.string()),
    work: v.any(),
    state: v.string(),
    idempotencyKey: v.optional(v.string()),
    settledAt: v.optional(v.number()),
  })
    .index('by_timer_id', ['timerId'])
    .index('by_namespace_state_fire', ['namespace', 'state', 'fireAt'])
    .index('by_work', ['workId'])
    .index('by_namespace_state_settled', ['namespace', 'state', 'settledAt'])
    .index('by_state_settled', ['state', 'settledAt']),

  runtimeOutbox: defineTable({
    outboxId: v.string(),
    namespace: v.string(),
    workId: v.optional(v.string()),
    envelope: v.any(),
    state: v.string(),
    attempts: v.number(),
    nextAttemptAt: v.number(),
    confirmedAt: v.optional(v.number()),
  })
    .index('by_outbox_id', ['outboxId'])
    .index('by_namespace_state_next', ['namespace', 'state', 'nextAttemptAt'])
    .index('by_work_state_next', ['workId', 'state', 'nextAttemptAt'])
    .index('by_work_namespace_state_next', [
      'workId',
      'namespace',
      'state',
      'nextAttemptAt',
    ])
    .index('by_namespace_state_confirmed', [
      'namespace',
      'state',
      'confirmedAt',
    ])
    .index('by_state_confirmed', ['state', 'confirmedAt']),

  runtimeIdempotency: defineTable({
    namespace: v.string(),
    key: v.string(),
    completedAt: v.number(),
  })
    .index('by_namespace_key', ['namespace', 'key'])
    .index('by_namespace_completed', ['namespace', 'completedAt'])
    .index('by_completed', ['completedAt']),

  runtimeLeases: defineTable({
    resource: v.string(),
    token: v.string(),
    ownerId: v.optional(v.string()),
    expiresAt: v.number(),
  }).index('by_resource', ['resource']),

  runtimeIdleCounters: defineTable({
    namespace: v.string(),
    scope: v.string(),
    count: v.number(),
  }).index('by_namespace_scope', ['namespace', 'scope']),

  runtimeDeferredScopes: defineTable({
    namespace: v.string(),
    scopeId: v.string(),
    leaseToken: v.string(),
    leaseExpiresAt: v.number(),
    finalization: v.any(),
    finalizationState: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_scope', ['namespace', 'scopeId'])
    .index('by_namespace_state_expiry', [
      'namespace',
      'finalizationState',
      'leaseExpiresAt',
    ]),

  runtimeDeferredIntents: defineTable({
    namespace: v.string(),
    scopeId: v.string(),
    intentId: v.string(),
    workId: v.string(),
    targetId: v.string(),
    input: v.any(),
    provenance: v.optional(v.any()),
    state: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_intent', ['namespace', 'intentId'])
    .index('by_scope_state', ['namespace', 'scopeId', 'state']),

  runtimeEffectRecords: defineTable({
    namespace: v.string(),
    kind: v.string(),
    recordId: v.string(),
    boundaryId: v.string(),
    record: v.any(),
    revision: v.number(),
    fenceToken: v.optional(v.string()),
    recoveryStatus: v.optional(v.string()),
    recoveryLeaseExpiresAt: v.optional(v.number()),
    retentionMode: v.optional(v.string()),
    retentionAt: v.optional(v.number()),
  })
    .index('by_identity', ['namespace', 'kind', 'recordId'])
    .index('by_boundary_kind', ['namespace', 'boundaryId', 'kind'])
    .index('by_recovery', [
      'namespace',
      'kind',
      'recoveryStatus',
      'recoveryLeaseExpiresAt',
    ])
    .index('by_retention', [
      'namespace',
      'kind',
      'retentionMode',
      'retentionAt',
    ])
    .index('by_retention_global', ['kind', 'retentionMode', 'retentionAt']),
})
