package devtools

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/url"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/resourceinspection"
	"github.com/use-crux/crux/packages/local/internal/store"

	_ "modernc.org/sqlite"
)

type fakeResourceInspector struct {
	result  resourceinspection.ResourceResult
	err     error
	request resourceinspection.ListRequest
}

func (f *fakeResourceInspector) List(_ context.Context, req resourceinspection.ListRequest) (resourceinspection.ResourceResult, error) {
	f.request = req
	return f.result, f.err
}

func TestMemoryStoreDetailJoinsIndexMetadataAndTrend(t *testing.T) {
	ctx := context.Background()
	st := store.NewStore()
	st.SetIndexData(store.IndexData{
		Definitions: []store.ProjectDefinition{
			{
				ID:       "memory:session",
				Kind:     "memory",
				Name:     "session",
				Source:   &store.SourceLoc{File: "/repo/src/memory.ts", Line: 12},
				Fidelity: "resolved",
				Metadata: json.RawMessage(`{
					"schema": {"name":"SessionState","fields":[{"name":"user_name","type":"string"}]},
					"backend": "convexMemoryStore",
					"evictionPolicy": "on run.end"
				}`),
			},
		},
	})
	st.MemoryRead(store.MemoryReadEvent{MemoryID: "session", MemoryType: "working", Operation: "get", TraceID: "trace_a", Timestamp: 1000})
	st.MemoryWrite(store.MemoryWriteEvent{MemoryID: "session", MemoryType: "working", Operation: "set", EntryKey: "user_name", Content: "Henri", TraceID: "trace_a", Timestamp: 2000, Snapshot: json.RawMessage(`{"user_name":"Henri"}`)})

	service := NewService(st, quality.NewService(st, t.TempDir()))
	value, found, err := service.Get(ctx, "/api/memory/stores/session", nil)
	if err != nil || !found {
		t.Fatalf("memory detail found=%v err=%v", found, err)
	}
	detail := value.(memoryStoreDetail)
	if detail.Source == nil || detail.Source.File != "/repo/src/memory.ts" || detail.Source.Line != 12 {
		t.Fatalf("source = %#v", detail.Source)
	}
	if detail.Schema == nil {
		t.Fatal("schema missing")
	}
	if detail.Backend != "convexMemoryStore" || detail.EvictionPolicy != "on run.end" {
		t.Fatalf("backend=%q eviction=%q", detail.Backend, detail.EvictionPolicy)
	}
	if detail.Stats.Trend == nil || len(detail.Stats.Trend.Reads) != 8 || len(detail.Stats.Trend.Writes) != 8 {
		t.Fatalf("trend = %#v", detail.Stats.Trend)
	}
}

func TestMemoryStoreDetailIncludesProjectionBackedInspectionNotice(t *testing.T) {
	ctx := context.Background()
	st := store.NewStore()
	st.MemoryWrite(store.MemoryWriteEvent{MemoryID: "session", MemoryType: "working", Operation: "set", EntryKey: "user_name", Content: "Henri", TraceID: "trace_a", Timestamp: 2000, Snapshot: json.RawMessage(`{"user_name":"Henri"}`)})
	inspector := &fakeResourceInspector{result: resourceinspection.ResourceResult{
		Status:     resourceinspection.StatusUnavailable,
		ResourceID: "memory:session",
		Kind:       "memory",
		Reason:     resourceinspection.ReasonBridgeRequired,
		Message:    "Enable Runtime Bridge to inspect live runtime-backed store data.",
		DocsURL:    resourceinspection.RuntimeBridgeDocsURL,
	}}

	service := NewService(st, quality.NewService(st, t.TempDir())).WithResourceInspection(inspector)
	value, found, err := service.Get(ctx, "/api/memory/stores/session", nil)
	if err != nil || !found {
		t.Fatalf("memory detail found=%v err=%v", found, err)
	}
	detail := value.(memoryStoreDetail)
	if inspector.request.ResourceID != "memory:session" || inspector.request.Limit != 100 {
		t.Fatalf("inspection request = %#v", inspector.request)
	}
	if detail.Inspection == nil {
		t.Fatal("inspection missing")
	}
	if detail.Inspection.Status != resourceinspection.StatusPartial || detail.Inspection.Source != resourceinspection.SourceProjection {
		t.Fatalf("inspection = %#v", detail.Inspection)
	}
	if detail.Inspection.Reason != resourceinspection.ReasonBridgeRequired || detail.State == nil {
		t.Fatalf("inspection reason=%q state=%#v", detail.Inspection.Reason, detail.State)
	}
}

func TestMemoryStoreDetailIncludesLiveInspectionEntries(t *testing.T) {
	ctx := context.Background()
	st := store.NewStore()
	st.MemoryWrite(store.MemoryWriteEvent{MemoryID: "session", MemoryType: "working", Operation: "set", EntryKey: "user_name", Content: "Henri", TraceID: "trace_a", Timestamp: 2000, Snapshot: json.RawMessage(`{"user_name":"Henri"}`)})
	inspector := &fakeResourceInspector{result: resourceinspection.ResourceResult{
		Status:     resourceinspection.StatusOK,
		Source:     resourceinspection.SourceRuntimeBridge,
		ResourceID: "memory:session",
		Kind:       "memory",
		Entries: []resourceinspection.ResourceEntry{
			{Key: "memory:session:user_name", Value: json.RawMessage(`{"value":"Henri"}`)},
		},
	}}

	service := NewService(st, quality.NewService(st, t.TempDir())).WithResourceInspection(inspector)
	value, found, err := service.Get(ctx, "/api/memory/stores/session", nil)
	if err != nil || !found {
		t.Fatalf("memory detail found=%v err=%v", found, err)
	}
	detail := value.(memoryStoreDetail)
	if detail.Inspection == nil {
		t.Fatal("inspection missing")
	}
	if detail.Inspection.Status != resourceinspection.StatusOK || detail.Inspection.Source != resourceinspection.SourceMixed {
		t.Fatalf("inspection = %#v", detail.Inspection)
	}
	if len(detail.Inspection.Entries) != 1 || detail.Inspection.Entries[0].Key != "memory:session:user_name" {
		t.Fatalf("entries = %#v", detail.Inspection.Entries)
	}
}

func TestMemoryStoreDetailJoinsIndexDefinitionByRuntimePrefix(t *testing.T) {
	ctx := context.Background()
	st := store.NewStore()
	st.SetIndexData(store.IndexData{
		Definitions: []store.ProjectDefinition{
			{
				ID:       "blackboard:thread",
				Kind:     "blackboard",
				Name:     "thread:*",
				Source:   &store.SourceLoc{File: "/repo/convex/agent/coordination/blackboard.ts", Line: 83},
				Fidelity: "partial",
				Metadata: json.RawMessage(`{
					"runtimeIdPrefix": "thread:",
					"schema": {"type":"object","properties":{"decisions":{"type":"array"}}},
					"backend": "cruxConvexStore",
					"conflictPolicy": "last-writer-wins"
				}`),
			},
		},
	})
	st.MemoryWrite(store.MemoryWriteEvent{MemoryID: "thread:m57ew2", MemoryType: "blackboard", Operation: "patch", EntryKey: "decisions", TraceID: "trace_a", Timestamp: 2000})

	service := NewService(st, quality.NewService(st, t.TempDir()))
	value, found, err := service.Get(ctx, "/api/memory/stores/thread:m57ew2", nil)
	if err != nil || !found {
		t.Fatalf("memory detail found=%v err=%v", found, err)
	}
	detail := value.(memoryStoreDetail)
	if detail.Source == nil || detail.Source.File != "/repo/convex/agent/coordination/blackboard.ts" {
		t.Fatalf("source = %#v", detail.Source)
	}
	if detail.Schema == nil || detail.Backend != "cruxConvexStore" || detail.ConflictPolicy != "last-writer-wins" {
		t.Fatalf("schema=%#v backend=%q conflict=%q", detail.Schema, detail.Backend, detail.ConflictPolicy)
	}
	state := detail.State.(map[string]any)
	if state["conflictPolicy"] != "last-writer-wins" {
		t.Fatalf("state conflict policy = %#v", state["conflictPolicy"])
	}
}

func TestBlackboardDetailDerivesFieldsFromLatestWriteSnapshots(t *testing.T) {
	ctx := context.Background()
	st := store.NewStore()
	st.MemoryWrite(store.MemoryWriteEvent{
		MemoryID:   "thread:m57ew2",
		MemoryType: "blackboard",
		Operation:  "patch",
		EntryKey:   "activePlanId",
		TraceID:    "trace_a",
		Timestamp:  2000,
		Snapshot:   json.RawMessage(`{"field":"activePlanId","value":"plan_123"}`),
	})
	st.MemoryWrite(store.MemoryWriteEvent{
		MemoryID:   "thread:m57ew2",
		MemoryType: "blackboard",
		Operation:  "patch",
		TraceID:    "trace_a",
		Timestamp:  3000,
		Snapshot:   json.RawMessage(`{"writerPlan":{"title":"Draft","sections":["Intro"]}}`),
	})

	service := NewService(st, quality.NewService(st, t.TempDir()))
	value, found, err := service.Get(ctx, "/api/memory/stores/thread:m57ew2", nil)
	if err != nil || !found {
		t.Fatalf("memory detail found=%v err=%v", found, err)
	}
	detail := value.(memoryStoreDetail)
	state := detail.State.(map[string]any)
	fields := state["fields"].([]map[string]any)
	seen := map[string]any{}
	for _, field := range fields {
		seen[field["name"].(string)] = field["value"]
	}
	if seen["activePlanId"] != "plan_123" {
		t.Fatalf("activePlanId field = %#v, fields=%#v", seen["activePlanId"], fields)
	}
	if _, ok := seen["writerPlan"].(map[string]any); !ok {
		t.Fatalf("writerPlan field = %#v, fields=%#v", seen["writerPlan"], fields)
	}
}

func TestBlackboardDetailDerivesFieldsFromReadSnapshots(t *testing.T) {
	ctx := context.Background()
	st := store.NewStore()
	st.MemoryRead(store.MemoryReadEvent{
		MemoryID:   "thread:m57ew2",
		MemoryType: "blackboard",
		Operation:  "get",
		TraceID:    "trace_a",
		Timestamp:  2000,
		Snapshot:   json.RawMessage(`{"field":"activePlanId","value":"plan_123"}`),
	})
	st.MemoryRead(store.MemoryReadEvent{
		MemoryID:   "thread:m57ew2",
		MemoryType: "blackboard",
		Operation:  "getAll",
		TraceID:    "trace_a",
		Timestamp:  3000,
		Snapshot:   json.RawMessage(`{"activePlanId":"plan_123","activeSkillIds":["fact-check"]}`),
	})

	service := NewService(st, quality.NewService(st, t.TempDir()))
	value, found, err := service.Get(ctx, "/api/memory/stores/thread:m57ew2", nil)
	if err != nil || !found {
		t.Fatalf("memory detail found=%v err=%v", found, err)
	}
	detail := value.(memoryStoreDetail)
	state := detail.State.(map[string]any)
	fields := state["fields"].([]map[string]any)
	seen := map[string]any{}
	for _, field := range fields {
		seen[field["name"].(string)] = field["value"]
	}
	if seen["activePlanId"] != "plan_123" {
		t.Fatalf("activePlanId field = %#v, fields=%#v", seen["activePlanId"], fields)
	}
	if skills, ok := seen["activeSkillIds"].([]any); !ok || len(skills) != 1 || skills[0] != "fact-check" {
		t.Fatalf("activeSkillIds field = %#v, fields=%#v", seen["activeSkillIds"], fields)
	}
}

// A recency/list-backed episodic block (no embedder) must NOT report a vector
// index — inferring "observed N/N" from entry count fabricates index health for
// a store that has none. An embedded block, by contrast, still gets an index.
func TestMemoryStoreDetailIndexHealthIsEmbedderAware(t *testing.T) {
	run := func(t *testing.T, blockJSON string) memoryStoreDetail {
		ctx := context.Background()
		st := store.NewStore()
		st.SetIndexData(store.IndexData{
			Definitions: []store.ProjectDefinition{
				{
					ID:       "memory:user-episodes",
					Kind:     "memory",
					Name:     "user-episodes:*",
					Source:   &store.SourceLoc{File: "/repo/convex/agent/memory/episodic.ts", Line: 21},
					Fidelity: "partial",
					Metadata: json.RawMessage(`{
						"runtimeIdPrefix": "user-episodes:",
						"backend": "cruxConvexStore",
						"blocks": [` + blockJSON + `]
					}`),
				},
			},
		})
		st.MemoryWrite(store.MemoryWriteEvent{MemoryID: "user-episodes:user:project", MemoryType: "episodic", Operation: "record", EntryKey: "episode_1", Content: "hello", TraceID: "trace_a", Timestamp: 2000, Snapshot: json.RawMessage(`{"key":"episode_1","content":"hello"}`)})

		service := NewService(st, quality.NewService(st, t.TempDir()))
		value, found, err := service.Get(ctx, "/api/memory/stores/user-episodes:user:project", nil)
		if err != nil || !found {
			t.Fatalf("memory detail found=%v err=%v", found, err)
		}
		return value.(memoryStoreDetail)
	}

	t.Run("recency store has no fabricated index", func(t *testing.T) {
		detail := run(t, `{"id":"episodes","kind":"episodes","schema":{"name":"EpisodicEntry","type":"object","properties":{"content":{"type":"string"}}}}`)
		if detail.Schema == nil || detail.Backend != "cruxConvexStore" {
			t.Fatalf("schema=%#v backend=%q", detail.Schema, detail.Backend)
		}
		state := detail.State.(map[string]any)
		if _, present := state["index"]; present {
			t.Fatalf("expected no index for recency store, got %#v", state["index"])
		}
	})

	t.Run("embedded store reports index", func(t *testing.T) {
		detail := run(t, `{"id":"episodes","kind":"episodes","hasEmbed":true}`)
		state := detail.State.(map[string]any)
		index, ok := state["index"].(map[string]any)
		if !ok {
			t.Fatalf("expected index for embedded store, got %#v", state["index"])
		}
		if index["indexedCount"] != 1 || index["targetCount"] != 1 {
			t.Fatalf("index = %#v", index)
		}
	})
}

// In the live devtools the in-memory instance index is never populated (it is
// only written by the in-process MemoryWrite/MemoryRead path used in tests), so
// episodic/semantic state must reconstruct entries from observability-derived
// write snapshots. This drives that projection path directly with inst == nil.
func TestEpisodicMemoryStateReconstructsEntriesFromSnapshots(t *testing.T) {
	events := []store.MemoryEventData{
		{Kind: "write", MemoryType: "episodic", Operation: "record", Key: "episode_1", Content: "user: hi", Timestamp: 1000,
			Snapshot: json.RawMessage(`{"key":"episode_1","content":"user: hi","metadata":{"tags":["greeting"]},"createdAt":1000,"updatedAt":1000}`)},
		{Kind: "read", MemoryType: "episodic", Operation: "list", Timestamp: 1500},
		{Kind: "write", MemoryType: "episodic", Operation: "record", Key: "episode_2", Content: "assistant: hello", Timestamp: 2000,
			Snapshot: json.RawMessage(`{"key":"episode_2","content":"assistant: hello","metadata":{},"createdAt":2000,"updatedAt":2000}`)},
	}

	state := episodicMemoryState(nil, events)
	entries, ok := state["entries"].([]map[string]any)
	if !ok || len(entries) != 2 {
		t.Fatalf("entries = %#v, want 2", state["entries"])
	}
	// Newest first.
	if entries[0]["id"] != "episode_2" || entries[0]["content"] != "assistant: hello" {
		t.Fatalf("entries[0] = %#v", entries[0])
	}
	if tags, _ := entries[1]["tags"].([]string); len(tags) != 1 || tags[0] != "greeting" {
		t.Fatalf("entries[1].tags = %#v, want [greeting]", entries[1]["tags"])
	}
}

func TestEpisodicMemoryStateSnapshotsHonorDeleteAndClear(t *testing.T) {
	base := []store.MemoryEventData{
		{Kind: "write", MemoryType: "episodic", Operation: "record", Key: "episode_1", Timestamp: 1000,
			Snapshot: json.RawMessage(`{"key":"episode_1","content":"first"}`)},
		{Kind: "write", MemoryType: "episodic", Operation: "record", Key: "episode_2", Timestamp: 2000,
			Snapshot: json.RawMessage(`{"key":"episode_2","content":"second"}`)},
	}

	deleted := append(append([]store.MemoryEventData{}, base...),
		store.MemoryEventData{Kind: "write", MemoryType: "episodic", Operation: "delete", Key: "episode_1", Timestamp: 3000})
	if entries := episodicMemoryState(nil, deleted)["entries"].([]map[string]any); len(entries) != 1 || entries[0]["id"] != "episode_2" {
		t.Fatalf("after delete entries = %#v, want only episode_2", entries)
	}

	cleared := append(append([]store.MemoryEventData{}, base...),
		store.MemoryEventData{Kind: "write", MemoryType: "episodic", Operation: "clear", Timestamp: 3000})
	if entries := episodicMemoryState(nil, cleared)["entries"].([]map[string]any); len(entries) != 0 {
		t.Fatalf("after clear entries = %#v, want empty", entries)
	}
}

func TestMemoryOperationsEndpointFiltersAndLimits(t *testing.T) {
	ctx := context.Background()
	st := store.NewStore()
	st.MemoryRead(store.MemoryReadEvent{SpanID: "span_read", RunID: "run_a", MemoryID: "session", MemoryType: "working", Operation: "get", TraceID: "trace_a", Timestamp: 1000})
	st.MemoryWrite(store.MemoryWriteEvent{SpanID: "span_write", RunID: "run_a", MemoryID: "session", MemoryType: "working", Operation: "set", EntryKey: "name", Content: "Henri", TraceID: "trace_a", Timestamp: 2000})

	service := NewService(st, quality.NewService(st, t.TempDir()))
	value, found, err := service.Get(ctx, "/api/memory/operations", url.Values{"since": []string{"1500"}, "limit": []string{"1"}})
	if err != nil || !found {
		t.Fatalf("memory operations found=%v err=%v", found, err)
	}
	ops := value.([]memoryOperationRecord)
	if len(ops) != 1 {
		t.Fatalf("ops len = %d", len(ops))
	}
	if ops[0].Op != "set" || ops[0].Key != "name" || ops[0].Value != "Henri" || ops[0].SpanID != "span_write" {
		t.Fatalf("op = %#v", ops[0])
	}
}

func TestPlansEndpointProjectsObservedPlanArtifacts(t *testing.T) {
	ctx := context.Background()
	st := store.NewStore()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	obs, err := observability.NewService(db)
	if err != nil {
		t.Fatal(err)
	}
	var batch observability.Batch
	if err := json.Unmarshal([]byte(`{
		"records": [
			{"schemaVersion":1,"recordId":"rec_plan_span","type":"span","runId":"run_a","traceId":"trace_a","spanId":"span_plan","family":"plan","primitive":"plan.operation","name":"plan.create","startedAt":"2026-05-21T10:00:00.000Z","endedAt":"2026-05-21T10:00:00.010Z","durationMs":10,"status":"ok","attributes":{"operation":"create","planId":"plan_123","title":"Draft plan"}},
			{"schemaVersion":1,"recordId":"rec_plan_artifact","type":"artifact","runId":"run_a","traceId":"trace_a","artifactId":"artifact_plan","spanId":"span_plan","kind":"output","createdAt":"2026-05-21T10:00:00.010Z","contentType":"application/json","encoding":"json","preview":{"primitive":"plan.operation","operation":"create","planId":"plan_123","title":"Draft plan","version":1,"content":"Full plan body","contentPreview":"Full plan body","metadata":{"status":"draft","draftId":"draft_1"}}}
		]
	}`), &batch); err != nil {
		t.Fatal(err)
	}
	if err := obs.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	service := NewService(st, quality.NewService(st, t.TempDir())).WithObservability(obs)
	value, found, err := service.Get(ctx, "/api/plans", nil)
	if err != nil || !found {
		t.Fatalf("plans found=%v err=%v", found, err)
	}
	plans := value.([]planSummary)
	if len(plans) != 1 {
		t.Fatalf("plans len = %d", len(plans))
	}
	if plans[0].ID != "plan_123" || plans[0].Title != "Draft plan" || plans[0].Status != "draft" || plans[0].ContentPreview != "Full plan body" {
		t.Fatalf("plan summary = %#v", plans[0])
	}

	value, found, err = service.Get(ctx, "/api/plans/plan_123", nil)
	if err != nil || !found {
		t.Fatalf("plan detail found=%v err=%v", found, err)
	}
	detail := value.(planDetail)
	if detail.Content != "Full plan body" || len(detail.Versions) != 1 || len(detail.Events) != 1 {
		t.Fatalf("plan detail = %#v", detail)
	}
}
