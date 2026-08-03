import { describe, it, expect } from "vitest";
import { devtoolsReducer, INITIAL_STATE } from "../devtoolsReducer";
import type { RuntimeFlowRun, DevtoolsState } from "../devtoolsReducer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal runtime flow run fixture */
function makeRuntimeFlow(
  overrides: Partial<RuntimeFlowRun> = {},
): RuntimeFlowRun {
  return {
    flowId: "rf1",
    sessionId: "sess1",
    name: "runtime-flow",
    startedAt: 1000,
    relatedTraceIds: [],
    steps: [],
    status: "running",
    ...overrides,
  };
}

function runtimeWith(
  overrides: Partial<DevtoolsState["runtime"]>,
): DevtoolsState {
  return {
    ...INITIAL_STATE,
    runtime: { ...INITIAL_STATE.runtime, ...overrides },
  };
}

function costBreakdown() {
  return {
    cost: 0.25,
    inputTokens: 1000,
    outputTokens: 2000,
    totalTokens: 3000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    calls: 1,
  };
}

function costEntry() {
  return {
    id: "tr-1",
    timestamp: 1000,
    source: "actual" as const,
    ...costBreakdown(),
    traceId: "tr-1",
    promptId: "summarize",
    model: "gpt-4o",
  };
}

function costReport() {
  const breakdown = costBreakdown();
  return {
    total: breakdown,
    byPrompt: { summarize: breakdown },
    byModel: { "gpt-4o": breakdown },
    byProvider: {},
    byAgent: {},
    byFlow: {},
    bySession: {},
    byStep: {},
    entries: [costEntry()],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("devtoolsReducer", () => {
  it("returns INITIAL_STATE for unknown action types", () => {
    const result = devtoolsReducer(INITIAL_STATE, { type: "UNKNOWN" } as any);
    expect(result).toBe(INITIAL_STATE);
  });

  // Index (prompts/contexts/tools) moved to TanStack Query — see
  // `hooks/useIndex.ts`. The reducer's `case 'index'` is now a
  // no-op; the WS handler in `useDevtools.ts` calls
  // `queryClient.setQueryData(qk.index(), ...)` directly. The
  // reducer test for this state is gone alongside the slice.

  // Eval, Baseline, and Review REST records are owned by TanStack Query,
  // not the push-only runtime reducer.

  // -------------------------------------------------------------------------
  // Runtime flow events
  // -------------------------------------------------------------------------
  describe("runtime-flow:start", () => {
    it("prepends new runtime flow with status running", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "runtime-flow:start",
        flowId: "rf1",
        sessionId: "sess1",
        name: "agent-flow",
        goal: "do stuff",
        startedAt: 1000,
        traceId: "tr1",
        parentFlowId: "pf1",
      });
      expect(result.runtime.runtimeFlowRuns).toHaveLength(1);
      const run = result.runtime.runtimeFlowRuns[0];
      expect(run.flowId).toBe("rf1");
      expect(run.status).toBe("running");
      expect(run.goal).toBe("do stuff");
      expect(run.triggerTraceId).toBe("tr1");
      expect(run.relatedTraceIds).toEqual(["tr1"]);
      expect(run.steps).toEqual([]);
      expect(run.parentFlowId).toBe("pf1");
    });

    it("populates relatedTraceIds as empty when no traceId", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "runtime-flow:start",
        flowId: "rf1",
        sessionId: "sess1",
        name: "flow",
        startedAt: 1000,
      });
      expect(result.runtime.runtimeFlowRuns[0].relatedTraceIds).toEqual([]);
      expect(result.runtime.runtimeFlowRuns[0].triggerTraceId).toBeUndefined();
    });

    it("deduplicates by flowId+sessionId", () => {
      const prev = runtimeWith({
        runtimeFlowRuns: [
          makeRuntimeFlow({ flowId: "rf1", sessionId: "sess1" }),
        ],
      });
      const result = devtoolsReducer(prev, {
        type: "runtime-flow:start",
        flowId: "rf1",
        sessionId: "sess1",
        name: "dup",
        startedAt: 2000,
      });
      expect(result.runtime.runtimeFlowRuns).toHaveLength(1);
      // State reference should be unchanged (early return)
      expect(result.runtime.runtimeFlowRuns).toBe(prev.runtime.runtimeFlowRuns);
    });
  });

  describe("runtime-flow:step", () => {
    it("appends new step to matching flow", () => {
      const prev = runtimeWith({
        runtimeFlowRuns: [
          makeRuntimeFlow({ flowId: "rf1", sessionId: "sess1" }),
        ],
      });
      const result = devtoolsReducer(prev, {
        type: "runtime-flow:step",
        flowId: "rf1",
        sessionId: "sess1",
        stepId: "step1",
        label: "Plan",
        status: "started",
        timestamp: 1100,
        traceId: "tr1",
        toolCallNames: ["search"],
      });
      const run = result.runtime.runtimeFlowRuns[0];
      expect(run.steps).toHaveLength(1);
      expect(run.steps[0].stepId).toBe("step1");
      expect(run.steps[0].label).toBe("Plan");
      expect(run.steps[0].toolCallNames).toEqual(["search"]);
    });

    it("updates existing step by stepId", () => {
      const prev = runtimeWith({
        runtimeFlowRuns: [
          makeRuntimeFlow({
            flowId: "rf1",
            sessionId: "sess1",
            steps: [
              {
                stepId: "step1",
                label: "Plan",
                status: "started",
                timestamp: 1100,
                toolCallNames: [],
              },
            ],
          }),
        ],
      });
      const result = devtoolsReducer(prev, {
        type: "runtime-flow:step",
        flowId: "rf1",
        sessionId: "sess1",
        stepId: "step1",
        label: "Plan",
        status: "completed",
        timestamp: 1200,
        durationMs: 100,
      });
      const run = result.runtime.runtimeFlowRuns[0];
      expect(run.steps).toHaveLength(1);
      expect(run.steps[0].status).toBe("completed");
      expect(run.steps[0].durationMs).toBe(100);
    });

    it("adds traceId to relatedTraceIds without duplicates", () => {
      const prev = runtimeWith({
        runtimeFlowRuns: [
          makeRuntimeFlow({
            flowId: "rf1",
            sessionId: "sess1",
            relatedTraceIds: ["tr1"],
          }),
        ],
      });
      // Same traceId: should not duplicate
      const result1 = devtoolsReducer(prev, {
        type: "runtime-flow:step",
        flowId: "rf1",
        sessionId: "sess1",
        stepId: "step1",
        label: "Step",
        status: "started",
        timestamp: 1100,
        traceId: "tr1",
      });
      expect(result1.runtime.runtimeFlowRuns[0].relatedTraceIds).toEqual([
        "tr1",
      ]);

      // New traceId: should append
      const result2 = devtoolsReducer(prev, {
        type: "runtime-flow:step",
        flowId: "rf1",
        sessionId: "sess1",
        stepId: "step2",
        label: "Step2",
        status: "started",
        timestamp: 1200,
        traceId: "tr2",
      });
      expect(result2.runtime.runtimeFlowRuns[0].relatedTraceIds).toEqual([
        "tr1",
        "tr2",
      ]);
    });
  });

  describe("runtime-flow:end", () => {
    it("sets status, durationMs, finishedAt, aggregate, error", () => {
      const prev = runtimeWith({
        runtimeFlowRuns: [
          makeRuntimeFlow({ flowId: "rf1", sessionId: "sess1" }),
        ],
      });
      const aggregate = { totalSteps: 3, totalTokens: 500, totalCost: 0.05 };
      const result = devtoolsReducer(prev, {
        type: "runtime-flow:end",
        flowId: "rf1",
        sessionId: "sess1",
        status: "completed",
        durationMs: 5000,
        timestamp: 6000,
        aggregate,
      });
      const run = result.runtime.runtimeFlowRuns[0];
      expect(run.status).toBe("completed");
      expect(run.durationMs).toBe(5000);
      expect(run.finishedAt).toBe(6000);
      expect(run.aggregate).toEqual(aggregate);
      expect(run.error).toBeUndefined();
    });

    it("sets error on failure", () => {
      const prev = runtimeWith({
        runtimeFlowRuns: [
          makeRuntimeFlow({ flowId: "rf1", sessionId: "sess1" }),
        ],
      });
      const result = devtoolsReducer(prev, {
        type: "runtime-flow:end",
        flowId: "rf1",
        sessionId: "sess1",
        status: "failed",
        durationMs: 1000,
        timestamp: 2000,
        error: "timeout",
      });
      expect(result.runtime.runtimeFlowRuns[0].status).toBe("failed");
      expect(result.runtime.runtimeFlowRuns[0].error).toBe("timeout");
    });
  });

  // -------------------------------------------------------------------------
  // Runtime events (individual)
  // -------------------------------------------------------------------------
  describe("runtime:snapshot", () => {
    it("sets all runtime arrays", () => {
      const memoryEvents = [
        {
          type: "memory:read" as const,
          _kind: "read" as const,
          memoryId: "m1",
          operation: "get",
          resultCount: 1,
          durationMs: 10,
          timestamp: 1000,
        },
      ];
      const embeddingEvents = [
        {
          type: "embed:start" as const,
          _kind: "start" as const,
          embedId: "emb1",
          name: "dense-test",
          kind: "dense" as const,
          operation: "embedMany" as const,
          inputCount: 2,
          chunkCount: 1,
          maxChunkSize: 2,
          timestamp: 1000,
        },
      ];
      const retrievalEvents = [
        {
          type: "retrieval:start" as const,
          _kind: "start" as const,
          retrievalId: "ret1",
          retrieverId: "docs",
          namespace: "knowledge",
          mode: "search" as const,
          query: "composable retrieval",
          limit: 5,
          fusion: "rrf" as const,
          rrfK: 60,
          searchLegs: ["dense", "sparse"],
          searchCandidates: { dense: 20, sparse: 30 },
          timestamp: 1000,
        },
      ];
      const indexEvents = [
        {
          type: "index:start" as const,
          _kind: "start" as const,
          indexId: "idx1",
          indexerId: "docs",
          namespace: "knowledge",
          operation: "indexDocuments" as const,
          sourceCount: 2,
          chunkCount: 6,
          replaceSources: true,
          timestamp: 1000,
        },
      ];
      const corpusEvents = [
        {
          type: "corpus:sync:end" as const,
          _kind: "sync:end" as const,
          syncId: "sync1",
          corpusId: "docs",
          namespace: "knowledge",
          mode: "replaceChanged" as const,
          stalePolicy: "keep" as const,
          sourceSet: "partial" as const,
          dryRun: false,
          added: 1,
          changed: 0,
          unchanged: 1,
          stale: 0,
          skipped: 0,
          deleted: 0,
          failed: 0,
          chunkCount: 4,
          durationMs: 12,
          timestamp: 1000,
        },
      ];
      const compactEvents = [
        {
          type: "compact:start" as const,
          _kind: "start" as const,
          reason: "budget",
          inputMessageCount: 5,
          inputTokens: 1000,
          timestamp: 1000,
        },
      ];
      const budgetSnapshots = [
        {
          type: "budget:check" as const,
          used: 500,
          available: 1000,
          level: "normal" as const,
          timestamp: 1000,
        },
      ];
      const costEvents = [
        {
          type: "cost:report" as const,
          _kind: "report" as const,
          traceId: "tr-1",
          entry: costEntry(),
          report: costReport(),
          timestamp: 1000,
        },
      ];
      const agentEvents = [
        {
          type: "blackboard:update" as const,
          _kind: "blackboard" as const,
          boardId: "b1",
          fieldsChanged: ["x"],
          timestamp: 1000,
        },
      ];
      const judgeEvents = [
        {
          type: "judge:result" as const,
          metricId: "accuracy",
          score: 0.9,
          timestamp: 1000,
        },
      ];
      const delegateEvents = [
        {
          type: "delegate:start" as const,
          _kind: "start" as const,
          delegateId: "d1",
          handoffId: "h1",
          inputSize: 100,
          timestamp: 1000,
        },
      ];
      const toolEvents = [
        {
          type: "tool:start" as const,
          _kind: "start" as const,
          toolCallId: "tc1",
          toolName: "search",
          args: {},
          timestamp: 1000,
        },
      ];
      const securityEvents = [
        {
          type: "security:warning" as const,
          promptId: "p1",
          field: "input",
          pattern: "ssn",
          message: "PII detected",
          inputPreview: "***",
          timestamp: 1000,
        },
      ];

      const result = devtoolsReducer(INITIAL_STATE, {
        type: "runtime:snapshot",
        embeddingEvents,
        retrievalEvents,
        indexEvents,
        corpusEvents,
        memoryEvents,
        compactEvents,
        budgetSnapshots,
        costEvents,
        agentEvents,
        judgeEvents,
        delegateEvents,
        toolEvents,
        securityEvents,
      });
      expect(result.runtime.embeddingEvents).toEqual(embeddingEvents);
      expect(result.runtime.retrievalEvents).toEqual(retrievalEvents);
      expect(result.runtime.indexEvents).toEqual(indexEvents);
      expect(result.runtime.corpusEvents).toEqual(corpusEvents);
      expect(result.runtime.memoryEvents).toEqual(memoryEvents);
      expect(result.runtime.compactEvents).toEqual(compactEvents);
      expect(result.runtime.budgetSnapshots).toEqual(budgetSnapshots);
      expect(result.runtime.costEvents).toEqual(costEvents);
      expect(result.runtime.agentEvents).toEqual(agentEvents);
      expect(result.runtime.judgeEvents).toEqual(judgeEvents);
      expect(result.runtime.delegateEvents).toEqual(delegateEvents);
      expect(result.runtime.toolEvents).toEqual(toolEvents);
      expect(result.runtime.securityEvents).toEqual(securityEvents);
    });

    it("keeps existing delegate/tool/security events when optional fields are absent", () => {
      const prev = runtimeWith({
        embeddingEvents: [
          {
            type: "embed:start" as const,
            _kind: "start" as const,
            embedId: "emb1",
            name: "dense-test",
            kind: "dense" as const,
            operation: "embed" as const,
            inputCount: 1,
            chunkCount: 1,
            maxChunkSize: 1,
            timestamp: 1000,
          },
        ],
        retrievalEvents: [
          {
            type: "retrieval:start" as const,
            _kind: "start" as const,
            retrievalId: "ret1",
            retrieverId: "docs",
            namespace: "knowledge",
            mode: "search" as const,
            query: "retrieval",
            timestamp: 1000,
          },
        ],
        indexEvents: [
          {
            type: "index:start" as const,
            _kind: "start" as const,
            indexId: "idx1",
            indexerId: "docs",
            namespace: "knowledge",
            operation: "indexDocuments" as const,
            sourceCount: 1,
            chunkCount: 2,
            timestamp: 1000,
          },
        ],
        delegateEvents: [
          {
            type: "delegate:start" as const,
            _kind: "start" as const,
            delegateId: "d1",
            handoffId: "h1",
            inputSize: 100,
            timestamp: 1000,
          },
        ],
        toolEvents: [
          {
            type: "tool:start" as const,
            _kind: "start" as const,
            toolCallId: "tc1",
            toolName: "x",
            args: {},
            timestamp: 1000,
          },
        ],
        securityEvents: [
          {
            type: "security:warning" as const,
            promptId: "p1",
            field: "f",
            pattern: "p",
            message: "m",
            inputPreview: "x",
            timestamp: 1000,
          },
        ],
      });
      const result = devtoolsReducer(prev, {
        type: "runtime:snapshot",
        memoryEvents: [],
        compactEvents: [],
        budgetSnapshots: [],
        agentEvents: [],
        judgeEvents: [],
      } as any);
      // When delegateEvents/toolEvents/securityEvents are not in the snapshot, they should be preserved
      expect(result.runtime.embeddingEvents).toEqual(
        prev.runtime.embeddingEvents,
      );
      expect(result.runtime.retrievalEvents).toEqual(
        prev.runtime.retrievalEvents,
      );
      expect(result.runtime.indexEvents).toEqual(prev.runtime.indexEvents);
      expect(result.runtime.delegateEvents).toEqual(
        prev.runtime.delegateEvents,
      );
      expect(result.runtime.toolEvents).toEqual(prev.runtime.toolEvents);
      expect(result.runtime.securityEvents).toEqual(
        prev.runtime.securityEvents,
      );
    });
  });

  describe("memory:read", () => {
    it("prepends with _kind read", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "memory:read",
        memoryId: "m1",
        operation: "search",
        resultCount: 3,
        durationMs: 50,
        timestamp: 1000,
      });
      expect(result.runtime.memoryEvents).toHaveLength(1);
      expect(result.runtime.memoryEvents[0]._kind).toBe("read");
      expect(result.runtime.memoryEvents[0].type).toBe("memory:read");
    });
  });

  describe("embed:start", () => {
    it("prepends with _kind start", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "embed:start",
        embedId: "emb1",
        name: "dense-test",
        kind: "dense",
        operation: "embedMany",
        inputCount: 2,
        chunkCount: 1,
        maxChunkSize: 2,
        timestamp: 1000,
      });
      expect(result.runtime.embeddingEvents).toHaveLength(1);
      expect(result.runtime.embeddingEvents[0]._kind).toBe("start");
    });
  });

  describe("embed:end", () => {
    it("prepends with _kind end", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "embed:end",
        embedId: "emb1",
        name: "dense-test",
        kind: "dense",
        operation: "embedMany",
        inputCount: 2,
        chunkCount: 1,
        maxChunkSize: 2,
        durationMs: 25,
        usage: { inputTokens: 10, totalTokens: 10 },
        cost: 0.01,
        timestamp: 1000,
      });
      expect(result.runtime.embeddingEvents).toHaveLength(1);
      expect(result.runtime.embeddingEvents[0]._kind).toBe("end");
    });
  });

  describe("retrieval:start", () => {
    it("prepends with _kind start", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "retrieval:start",
        retrievalId: "ret1",
        retrieverId: "docs",
        namespace: "knowledge",
        mode: "search",
        query: "composable retrieval",
        limit: 5,
        fusion: "rrf",
        rrfK: 60,
        searchLegs: ["dense", "sparse"],
        searchCandidates: { dense: 20, sparse: 30 },
        timestamp: 1000,
      });
      expect(result.runtime.retrievalEvents).toHaveLength(1);
      expect(result.runtime.retrievalEvents[0]._kind).toBe("start");
    });
  });

  describe("retrieval:end", () => {
    it("prepends with _kind end", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "retrieval:end",
        retrievalId: "ret1",
        retrieverId: "docs",
        namespace: "knowledge",
        mode: "search",
        query: "composable retrieval",
        resultCount: 3,
        durationMs: 18,
        timestamp: 1000,
      });
      expect(result.runtime.retrievalEvents).toHaveLength(1);
      expect(result.runtime.retrievalEvents[0]._kind).toBe("end");
    });
  });

  describe("retrieval stage events", () => {
    it("stores stage start and end events with stage kinds", () => {
      const started = devtoolsReducer(INITIAL_STATE, {
        type: "retrieval:stage:start",
        retrievalId: "ret1",
        retrieverId: "docs",
        pipelineId: "docs",
        stageName: "multi-query",
        stageKind: "multi-query",
        phase: "query",
        inputQueryCount: 1,
        timestamp: 1000,
      });

      const ended = devtoolsReducer(started, {
        type: "retrieval:stage:end",
        retrievalId: "ret1",
        retrieverId: "docs",
        pipelineId: "docs",
        stageName: "multi-query",
        stageKind: "multi-query",
        phase: "query",
        status: "success",
        inputQueryCount: 1,
        outputQueryCount: 4,
        durationMs: 12,
        warningCount: 0,
        preview: { queries: [{ query: "refund policy" }] },
        timestamp: 1012,
      });

      expect(ended.runtime.retrievalStageEvents).toHaveLength(2);
      expect(ended.runtime.retrievalStageEvents[0]).toMatchObject({
        _kind: "stage-end",
        stageName: "multi-query",
        outputQueryCount: 4,
      });
      expect(ended.runtime.retrievalStageEvents[1]).toMatchObject({
        _kind: "stage-start",
        inputQueryCount: 1,
      });
    });
  });

  describe("workspace:operation", () => {
    it("stores workspace operation events", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "workspace:operation",
        workspaceId: "research",
        namespace: "thread:1",
        operation: "write",
        path: "/outputs/report.pdf",
        status: "success",
        durationMs: 12,
        mimeType: "application/pdf",
        size: 42,
        timestamp: 1000,
      });

      expect(result.runtime.workspaceEvents).toHaveLength(1);
      expect(result.runtime.workspaceEvents[0]).toMatchObject({
        workspaceId: "research",
        operation: "write",
        path: "/outputs/report.pdf",
      });
    });
  });

  describe("index:start", () => {
    it("prepends with _kind start", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "index:start",
        indexId: "idx1",
        indexerId: "docs",
        namespace: "knowledge",
        operation: "indexDocuments",
        sourceCount: 2,
        chunkCount: 6,
        replaceSources: true,
        timestamp: 1000,
      });
      expect(result.runtime.indexEvents).toHaveLength(1);
      expect(result.runtime.indexEvents[0]._kind).toBe("start");
    });
  });

  describe("index:end", () => {
    it("prepends with _kind end", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "index:end",
        indexId: "idx1",
        indexerId: "docs",
        namespace: "knowledge",
        operation: "indexDocuments",
        sourceCount: 2,
        chunkCount: 6,
        durationMs: 42,
        timestamp: 1000,
      });
      expect(result.runtime.indexEvents).toHaveLength(1);
      expect(result.runtime.indexEvents[0]._kind).toBe("end");
    });
  });

  describe("corpus events", () => {
    it("prepends sync/source events with normalized _kind values", () => {
      const afterStart = devtoolsReducer(INITIAL_STATE, {
        type: "corpus:sync:start",
        syncId: "sync1",
        corpusId: "docs",
        namespace: "knowledge",
        mode: "replaceChanged",
        stalePolicy: "keep",
        sourceSet: "partial",
        dryRun: true,
        sourceCount: 1,
        timestamp: 1000,
      });

      const afterSource = devtoolsReducer(afterStart, {
        type: "corpus:source:added",
        syncId: "sync1",
        corpusId: "docs",
        namespace: "knowledge",
        sourceId: "guide.md",
        action: "added",
        reason: "new",
        dryRun: true,
        chunkCount: 4,
        timestamp: 1001,
      });

      const afterEnd = devtoolsReducer(afterSource, {
        type: "corpus:sync:end",
        syncId: "sync1",
        corpusId: "docs",
        namespace: "knowledge",
        mode: "replaceChanged",
        stalePolicy: "keep",
        sourceSet: "partial",
        dryRun: true,
        added: 1,
        changed: 0,
        unchanged: 0,
        stale: 0,
        skipped: 0,
        deleted: 0,
        failed: 0,
        chunkCount: 4,
        durationMs: 12,
        timestamp: 1002,
      });

      expect(afterEnd.runtime.corpusEvents).toHaveLength(3);
      expect(afterEnd.runtime.corpusEvents[0]._kind).toBe("sync:end");
      expect(afterEnd.runtime.corpusEvents[1]._kind).toBe("source");
      expect(afterEnd.runtime.corpusEvents[2]._kind).toBe("sync:start");
    });
  });

  describe("ingest events", () => {
    it("prepends parser events with normalized _kind values", () => {
      const afterStart = devtoolsReducer(INITIAL_STATE, {
        type: "ingest:parse:start",
        ingestId: "ing1",
        parser: "pdf",
        format: "pdf",
        namespace: "knowledge",
        sourceId: "guide.pdf",
        byteLength: 1024,
        timestamp: 1000,
      });

      const afterEnd = devtoolsReducer(afterStart, {
        type: "ingest:parse:end",
        ingestId: "ing1",
        parser: "pdf",
        format: "pdf",
        namespace: "knowledge",
        sourceId: "guide.pdf",
        byteLength: 1024,
        durationMs: 24,
        partCount: 3,
        warningCount: 1,
        timestamp: 1001,
      });

      expect(afterEnd.runtime.ingestEvents).toHaveLength(2);
      expect(afterEnd.runtime.ingestEvents[0]._kind).toBe("end");
      expect(afterEnd.runtime.ingestEvents[0]).toMatchObject({
        partCount: 3,
        warningCount: 1,
      });
      expect(afterEnd.runtime.ingestEvents[1]._kind).toBe("start");
    });
  });

  describe("memory:write", () => {
    it("prepends with _kind write", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "memory:write",
        memoryId: "m1",
        operation: "set",
        timestamp: 1000,
      });
      expect(result.runtime.memoryEvents).toHaveLength(1);
      expect(result.runtime.memoryEvents[0]._kind).toBe("write");
    });
  });

  describe("compact:start", () => {
    it("prepends with _kind start", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "compact:start",
        reason: "budget exceeded",
        inputMessageCount: 10,
        inputTokens: 5000,
        timestamp: 1000,
      });
      expect(result.runtime.compactEvents).toHaveLength(1);
      expect(result.runtime.compactEvents[0]._kind).toBe("start");
    });
  });

  describe("compact:end", () => {
    it("prepends with _kind end", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "compact:end",
        outputTokens: 200,
        compressionRatio: 0.5,
        durationMs: 300,
        timestamp: 1000,
      });
      expect(result.runtime.compactEvents).toHaveLength(1);
      expect(result.runtime.compactEvents[0]._kind).toBe("end");
    });
  });

  describe("budget:check", () => {
    it("prepends to budgetSnapshots", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "budget:check",
        used: 800,
        available: 1000,
        level: "warning",
        timestamp: 1000,
      });
      expect(result.runtime.budgetSnapshots).toHaveLength(1);
      expect(result.runtime.budgetSnapshots[0].level).toBe("warning");
    });
  });

  describe("cost events", () => {
    it("prepends cost reports and budget events with _kind", () => {
      const report = costReport();
      const entry = costEntry();
      const afterReport = devtoolsReducer(INITIAL_STATE, {
        type: "cost:report",
        traceId: "tr-1",
        entry,
        report,
        timestamp: 1000,
      });
      const afterWarn = devtoolsReducer(afterReport, {
        type: "cost:warn",
        traceId: "tr-1",
        threshold: 0.1,
        actual: 0.25,
        entry,
        report,
        timestamp: 1001,
      });
      expect(afterWarn.runtime.costEvents).toHaveLength(2);
      expect(afterWarn.runtime.costEvents[0]._kind).toBe("warn");
      expect(afterWarn.runtime.costEvents[1]._kind).toBe("report");
    });
  });

  describe("blackboard:update", () => {
    it("prepends to agentEvents with _kind blackboard", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "blackboard:update",
        boardId: "b1",
        fieldsChanged: ["status", "plan"],
        timestamp: 1000,
      });
      expect(result.runtime.agentEvents).toHaveLength(1);
      expect(result.runtime.agentEvents[0]._kind).toBe("blackboard");
      expect(result.runtime.agentEvents[0].type).toBe("blackboard:update");
    });
  });

  describe("handoff:prepare", () => {
    it("prepends to agentEvents with _kind handoff", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "handoff:prepare",
        handoffId: "h1",
        inputSize: 500,
        outputSize: 300,
        timestamp: 1000,
      });
      expect(result.runtime.agentEvents).toHaveLength(1);
      expect(result.runtime.agentEvents[0]._kind).toBe("handoff");
    });
  });

  describe("judge:result", () => {
    it("prepends to judgeEvents", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "judge:result",
        metricId: "accuracy",
        score: 0.85,
        reasoning: "Good output",
        timestamp: 1000,
      });
      expect(result.runtime.judgeEvents).toHaveLength(1);
      expect(result.runtime.judgeEvents[0].score).toBe(0.85);
    });
  });

  describe("delegate:start", () => {
    it("prepends with _kind start", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "delegate:start",
        delegateId: "d1",
        handoffId: "h1",
        inputSize: 200,
        timestamp: 1000,
      });
      expect(result.runtime.delegateEvents).toHaveLength(1);
      expect(result.runtime.delegateEvents[0]._kind).toBe("start");
    });
  });

  describe("delegate:complete", () => {
    it("prepends with _kind complete", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "delegate:complete",
        delegateId: "d1",
        handoffId: "h1",
        inputSize: 200,
        outputSize: 300,
        durationMs: 500,
        timestamp: 1000,
      });
      expect(result.runtime.delegateEvents).toHaveLength(1);
      expect(result.runtime.delegateEvents[0]._kind).toBe("complete");
    });
  });

  describe("tool:start", () => {
    it("prepends with _kind start", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "tool:start",
        toolCallId: "tc1",
        toolName: "search",
        args: { query: "test" },
        timestamp: 1000,
      });
      expect(result.runtime.toolEvents).toHaveLength(1);
      expect(result.runtime.toolEvents[0]._kind).toBe("start");
    });
  });

  describe("tool:end", () => {
    it("prepends with _kind end", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "tool:end",
        toolCallId: "tc1",
        toolName: "search",
        durationMs: 150,
        modelOutput: { type: "text", value: "compact result" },
        modelOutputType: "text",
        outputSize: 1200,
        modelOutputSize: 80,
        tokenSavingsEstimate: 1120,
        timestamp: 1000,
      });
      expect(result.runtime.toolEvents).toHaveLength(1);
      expect(result.runtime.toolEvents[0]._kind).toBe("end");
      const event = result.runtime.toolEvents[0];
      if (event._kind !== "end") throw new Error("Expected tool:end event");
      expect(event.tokenSavingsEstimate).toBe(1120);
    });
  });

  describe("tool approval events", () => {
    it("prepends approval request and decision events to toolEvents", () => {
      const withRequest = devtoolsReducer(INITIAL_STATE, {
        type: "tool:approval:request",
        approvalId: "approval_tc1",
        toolCallId: "tc1",
        toolName: "sendEmail",
        input: { to: "customer@example.com" },
        timestamp: 1000,
      });
      const withDecision = devtoolsReducer(withRequest, {
        type: "tool:approval:decision",
        approvalId: "approval_tc1",
        toolCallId: "tc1",
        toolName: "sendEmail",
        approved: false,
        reason: "Wrong customer",
        timestamp: 1100,
      });

      expect(withDecision.runtime.toolEvents).toHaveLength(2);
      expect(withDecision.runtime.toolEvents[0]._kind).toBe(
        "approval-decision",
      );
      expect(withDecision.runtime.toolEvents[1]._kind).toBe("approval-request");
    });
  });

  describe("security:warning", () => {
    it("prepends to securityEvents", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "security:warning",
        promptId: "p1",
        field: "input.email",
        pattern: "email",
        message: "PII detected in input",
        inputPreview: "***@***.com",
        timestamp: 1000,
      });
      expect(result.runtime.securityEvents).toHaveLength(1);
      expect(result.runtime.securityEvents[0].field).toBe("input.email");
    });
  });

  // -------------------------------------------------------------------------
  // Internal actions
  // -------------------------------------------------------------------------
  describe("SET_CONNECTED", () => {
    it("updates connected field only", () => {
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "SET_CONNECTED",
        connected: true,
      });
      expect(result.connected).toBe(true);
      // Everything else unchanged
      expect(result.runtime).toBe(INITIAL_STATE.runtime);
    });
  });

  // SET_DASHBOARD / PATCH_DASHBOARD were dropped together with the
  // unused dashboard polling slice — no screen consumed it.

  describe("SET_RUNTIME_FLOWS", () => {
    it("replaces runtimeFlowRuns", () => {
      const flows = [makeRuntimeFlow({ flowId: "rf1" })];
      const result = devtoolsReducer(INITIAL_STATE, {
        type: "SET_RUNTIME_FLOWS",
        runtimeFlowRuns: flows,
      });
      expect(result.runtime.runtimeFlowRuns).toEqual(flows);
    });
  });

  // SET_CATALOG (the REST-on-connect dispatch) was removed alongside the
  // index reducer slice when prompts/contexts/tools moved to Query.
});
