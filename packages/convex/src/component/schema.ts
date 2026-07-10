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
  }).index(STORE_DOC_COMPONENT_SPEC.indexes.byKey, [STORE_DOC_COMPONENT_SPEC.fields.key]),

  swarmRuns: defineTable({
    swarmRunId: v.string(),
    currentAgentId: v.string(),
    handoffPath: v.array(v.string()),
    handoffCount: v.number(),
    currentInput: v.any(),
    originalInput: v.any(),
    status: v.union(v.literal('running'), v.literal('completed'), v.literal('error')),
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
    targetId: v.string(),
    status: v.string(),
    attempt: v.number(),
    maxAttempts: v.number(),
    notBefore: v.optional(v.number()),
    idempotencyKey: v.string(),
    idleScope: v.optional(v.string()),
    leaseToken: v.optional(v.string()),
    lastError: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_work_id', ['workId'])
    .index('by_namespace_status_updated', ['namespace', 'status', 'updatedAt'])
    .index('by_status_updated', ['status', 'updatedAt']),

  runtimeSnapshots: defineTable({
    flowId: v.string(),
    workId: v.string(),
    targetId: v.string(),
    namespace: v.string(),
    status: v.string(),
    input: v.any(),
    completedSteps: v.any(),
    fingerprint: v.array(v.string()),
    pendingSuspends: v.any(),
    deliveredSuspends: v.optional(v.any()),
    scheduledEffects: v.optional(v.any()),
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
    .index('by_work_namespace_state_next', ['workId', 'namespace', 'state', 'nextAttemptAt'])
    .index('by_namespace_state_confirmed', ['namespace', 'state', 'confirmedAt'])
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
})
