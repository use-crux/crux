package devtools

import (
	"context"
	"database/sql"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/inspect"
	"github.com/use-crux/crux/packages/local/internal/observability"
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
					"captureMode": "afterResponse",
					"budget": {"maxTokens": 1200},
					"evictionPolicy": "on run.end",
					"blocks": [
						{"id":"state","kind":"working","priority":80,"budget":{"maxTokens":300}},
						{"id":"facts","kind":"facts","writeMode":"propose","renderStrategy":"semantic","renderLimit":4}
					]
				}`),
			},
		},
	})
	st.MemoryRead(store.MemoryReadEvent{MemoryID: "session", MemoryType: "working", Operation: "get", TraceID: "trace_a", Timestamp: 1000})
	st.MemoryWrite(store.MemoryWriteEvent{MemoryID: "session", MemoryType: "working", Operation: "set", EntryKey: "user_name", Content: "Henri", TraceID: "trace_a", Timestamp: 2000, Snapshot: json.RawMessage(`{"user_name":"Henri"}`)})

	service := NewService(st, inspect.NewService(st, t.TempDir()))
	value, found, err := service.MemoryStoreDetail(ctx, "session")
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
	if detail.CaptureMode != "afterResponse" {
		t.Fatalf("captureMode = %q", detail.CaptureMode)
	}
	if budget, ok := detail.Budget.(map[string]any); !ok || budget["maxTokens"] != float64(1200) {
		t.Fatalf("budget = %#v", detail.Budget)
	}
	if len(detail.Blocks) != 2 {
		t.Fatalf("blocks = %#v", detail.Blocks)
	}
	if detail.Blocks[1].RenderStrategy != "semantic" || detail.Blocks[1].RenderLimit != float64(4) || detail.Blocks[1].WriteMode != "propose" {
		t.Fatalf("facts block = %#v", detail.Blocks[1])
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

	service := NewService(st, inspect.NewService(st, t.TempDir())).WithResourceInspection(inspector)
	value, found, err := service.MemoryStoreDetail(ctx, "session")
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

	service := NewService(st, inspect.NewService(st, t.TempDir())).WithResourceInspection(inspector)
	value, found, err := service.MemoryStoreDetail(ctx, "session")
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

func TestWorkspaceReadmodelsIncludeAuthoredSourceBackedMounts(t *testing.T) {
	ctx := context.Background()
	st := store.NewStore()
	st.SetIndexData(store.IndexData{
		Definitions: []store.ProjectDefinition{
			{
				ID:       "workspace:scratch",
				Kind:     "workspace",
				Name:     "scratch",
				Fidelity: "resolved",
				Metadata: json.RawMessage(`{
					"namespace": "tenant-a",
					"mounts": [
						{
							"path": "/docs",
							"access": "read",
							"source": {
								"kind": "retriever",
								"helper": "retrieverWorkspaceMountSource",
								"capabilities": ["list", "read", "grep", "exists", "stat"]
							}
						},
						{
							"path": "/drafts",
							"access": "readwrite",
							"source": {
								"kind": "custom",
								"capabilities": ["list", "read", "write"]
							}
						}
					]
				}`),
			},
		},
	})

	service := NewService(st, inspect.NewService(st, t.TempDir()))
	value, err := service.Workspaces(ctx)
	if err != nil {
		t.Fatalf("workspaces error = %v", err)
	}
	summaries := value.([]workspaceSummary)
	if len(summaries) != 1 || summaries[0].ID != "scratch" || summaries[0].Namespace != "tenant-a" {
		t.Fatalf("summaries = %#v", summaries)
	}
	if len(summaries[0].Mounts) != 2 {
		t.Fatalf("mounts = %#v", summaries[0].Mounts)
	}
	docs := summaries[0].Mounts[0]
	if docs.Path != "/docs" || docs.Mode != "read-only" || docs.SourceKind != "retriever" || docs.SourceHelper != "retrieverWorkspaceMountSource" {
		t.Fatalf("docs mount = %#v", docs)
	}
	if !reflect.DeepEqual(docs.Capabilities, []string{"list", "read", "grep", "exists", "stat"}) {
		t.Fatalf("docs capabilities = %#v", docs.Capabilities)
	}

	detailValue, found, err := service.WorkspaceDetail(ctx, "scratch")
	if err != nil || !found {
		t.Fatalf("workspace detail found=%v err=%v", found, err)
	}
	detail := detailValue.(workspaceDetail)
	if len(detail.Mounts) != 2 || detail.Mounts[1].Mode != "read-write" || detail.Mounts[1].SourceKind != "custom" {
		t.Fatalf("detail mounts = %#v", detail.Mounts)
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

	service := NewService(st, inspect.NewService(st, t.TempDir()))
	value, found, err := service.MemoryStoreDetail(ctx, "thread:m57ew2")
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

	service := NewService(st, inspect.NewService(st, t.TempDir()))
	value, found, err := service.MemoryStoreDetail(ctx, "thread:m57ew2")
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

	service := NewService(st, inspect.NewService(st, t.TempDir()))
	value, found, err := service.MemoryStoreDetail(ctx, "thread:m57ew2")
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

		service := NewService(st, inspect.NewService(st, t.TempDir()))
		value, found, err := service.MemoryStoreDetail(ctx, "user-episodes:user:project")
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

func TestMemoryStoreDetailUsesIndexedBlockRetention(t *testing.T) {
	ctx := context.Background()
	st := store.NewStore()
	st.SetIndexData(store.IndexData{
		Definitions: []store.ProjectDefinition{
			{
				ID:       "memory:user-episodes",
				Kind:     "memory",
				Name:     "user-episodes:*",
				Fidelity: "partial",
				Metadata: json.RawMessage(`{
					"runtimeIdPrefix": "user-episodes:",
					"blocks": [
						{"id":"episodes","kind":"episodes","retentionPolicy":"90d"}
					]
				}`),
			},
		},
	})
	st.MemoryWrite(store.MemoryWriteEvent{
		MemoryID:   "user-episodes:user:project",
		MemoryType: "episodic",
		Operation:  "record",
		EntryKey:   "episode_1",
		Content:    "hello",
		TraceID:    "trace_a",
		Timestamp:  2000,
		Snapshot:   json.RawMessage(`{"key":"episode_1","content":"hello"}`),
	})

	service := NewService(st, inspect.NewService(st, t.TempDir()))
	value, found, err := service.MemoryStoreDetail(ctx, "user-episodes:user:project")
	if err != nil || !found {
		t.Fatalf("memory detail found=%v err=%v", found, err)
	}
	detail := value.(memoryStoreDetail)
	state := detail.State.(map[string]any)
	retention, ok := state["retention"].(map[string]any)
	if !ok || retention["policy"] != "90d" {
		t.Fatalf("retention = %#v", state["retention"])
	}
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

	service := NewService(st, inspect.NewService(st, t.TempDir()))
	value, err := service.MemoryOperations(ctx, 1500, 0, 1)
	if err != nil {
		t.Fatalf("memory operations: %v", err)
	}
	ops := value.([]memoryOperationRecord)
	if len(ops) != 1 {
		t.Fatalf("ops len = %d", len(ops))
	}
	if ops[0].Op != "set" || ops[0].Key != "name" || ops[0].Value != "Henri" || ops[0].SpanID != "span_write" {
		t.Fatalf("op = %#v", ops[0])
	}
}

func TestWorkspaceDetailUsesPathHashAndArtifactMetadataFromObservedActivity(t *testing.T) {
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
			{"schemaVersion":4,"recordId":"rec_write","type":"span","runId":"run_ws","operationId":"run_ws","segmentId":"run_ws_seg","segmentSeq":1,"traceId":"trace_ws","spanId":"span_write","family":"workspace","primitive":"workspace.operation","name":"workspace.write","startedAt":"2026-06-30T10:00:00.000Z","endedAt":"2026-06-30T10:00:00.012Z","durationMs":12,"status":"ok","attributes":{"workspaceId":"drafts","operation":"write","pathHash":"fnv1a:aaa111","namespaceHash":"ns1","mimeType":"text/markdown","size":42,"artifactStatus":"draft","artifactKind":"report"}},
			{"schemaVersion":4,"recordId":"rec_finalize","type":"span","runId":"run_ws","operationId":"run_ws","segmentId":"run_ws_seg","segmentSeq":2,"traceId":"trace_ws","spanId":"span_finalize","family":"workspace","primitive":"workspace.operation","name":"workspace.finalize","startedAt":"2026-06-30T10:00:01.000Z","endedAt":"2026-06-30T10:00:01.009Z","durationMs":9,"status":"ok","attributes":{"workspaceId":"drafts","operation":"finalize","pathHash":"fnv1a:bbb222","namespaceHash":"ns1","mimeType":"application/pdf","size":9001,"artifactStatus":"final","artifactKind":"report","uri":"workspace-inline://drafts/ns1/outputs/report.pdf"}},
			{"schemaVersion":4,"recordId":"artifact_finalize","type":"artifact","runId":"run_ws","operationId":"run_ws","segmentId":"run_ws_seg","segmentSeq":3,"traceId":"trace_ws","artifactId":"artifact_report","spanId":"span_finalize","kind":"output","createdAt":"2026-06-30T10:00:01.009Z","contentType":"application/json","encoding":"json","sizeBytes":9001,"uri":"workspace-inline://drafts/ns1/outputs/report.pdf","preview":{"contentStored":false},"attributes":{"workspaceId":"drafts","operation":"finalize","pathHash":"fnv1a:bbb222","artifactStatus":"final","artifactKind":"report","mimeType":"application/pdf","size":9001,"uri":"workspace-inline://drafts/ns1/outputs/report.pdf"}}
		]
	}`), &batch); err != nil {
		t.Fatal(err)
	}
	if err := obs.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	service := NewService(st, inspect.NewService(st, t.TempDir())).WithObservability(obs)
	value, found, err := service.WorkspaceDetail(ctx, "drafts")
	if err != nil || !found {
		t.Fatalf("workspace detail found=%v err=%v", found, err)
	}
	detail := value.(workspaceDetail)
	if len(detail.Files) != 2 {
		t.Fatalf("files = %#v", detail.Files)
	}
	byPath := map[string]workspaceFileSummary{}
	for _, file := range detail.Files {
		byPath[file.Path] = file
		if file.Path == "/" {
			t.Fatalf("file collapsed to root: %#v", file)
		}
	}
	if byPath["hash:fnv1a:aaa111"].Op != "write" || byPath["hash:fnv1a:bbb222"].Op != "finalize" {
		t.Fatalf("files by path = %#v", byPath)
	}
	finalized := byPath["hash:fnv1a:bbb222"]
	if finalized.ArtifactStatus != "final" || finalized.ArtifactKind != "report" || finalized.URI != "workspace-inline://drafts/ns1/outputs/report.pdf" {
		t.Fatalf("finalized artifact metadata = %#v", finalized)
	}
}

func TestWorkspaceDetailRemovesDeletedFilesFromTree(t *testing.T) {
	ctx := context.Background()
	st := store.NewStore()
	size := 42
	st.WorkspaceOperation(store.WorkspaceOperationEvent{
		WorkspaceID: "drafts",
		Namespace:   "thread:1",
		Operation:   "write",
		Path:        "/outputs/report.md",
		Status:      "success",
		Timestamp:   1,
		MimeType:    "text/markdown",
		Size:        &size,
	})
	st.WorkspaceOperation(store.WorkspaceOperationEvent{
		WorkspaceID: "drafts",
		Namespace:   "thread:1",
		Operation:   "write",
		Path:        "/outputs/summary.md",
		Status:      "success",
		Timestamp:   2,
		MimeType:    "text/markdown",
		Size:        &size,
	})
	st.WorkspaceOperation(store.WorkspaceOperationEvent{
		WorkspaceID: "drafts",
		Namespace:   "thread:1",
		Operation:   "delete",
		Path:        "/outputs/report.md",
		Status:      "success",
		Timestamp:   3,
	})

	service := NewService(st, inspect.NewService(st, t.TempDir()))
	value, found, err := service.WorkspaceDetail(ctx, "drafts")
	if err != nil || !found {
		t.Fatalf("workspace detail found=%v err=%v", found, err)
	}
	detail := value.(workspaceDetail)
	if len(detail.Files) != 1 || detail.Files[0].Path != "/outputs/summary.md" {
		t.Fatalf("files = %#v, want only surviving file", detail.Files)
	}
	foundOutputsMount := false
	for _, mount := range detail.Mounts {
		if mount.Path == "/outputs" {
			foundOutputsMount = true
			if mount.FileCount != 1 {
				t.Fatalf("mounts = %#v, want deleted file removed from mount counts", detail.Mounts)
			}
		}
	}
	if !foundOutputsMount {
		t.Fatalf("mounts = %#v, want surviving /outputs mount", detail.Mounts)
	}
	if len(detail.RecentOps) != 3 {
		t.Fatalf("recent ops = %#v, want writes and delete retained", detail.RecentOps)
	}
}

func TestWorkspaceDetailMovesRenamedFilesFromObservedActivity(t *testing.T) {
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
			{"schemaVersion":4,"recordId":"rec_write","type":"span","runId":"run_ws","operationId":"run_ws","segmentId":"run_ws_seg","segmentSeq":1,"traceId":"trace_ws","spanId":"span_write","family":"workspace","primitive":"workspace.operation","name":"workspace.write","startedAt":"2026-06-30T10:00:00.000Z","endedAt":"2026-06-30T10:00:00.012Z","durationMs":12,"status":"ok","attributes":{"workspaceId":"drafts","operation":"write","pathHash":"fnv1a:old111","namespaceHash":"ns1","mimeType":"text/markdown","size":42}},
			{"schemaVersion":4,"recordId":"artifact_write","type":"artifact","runId":"run_ws","operationId":"run_ws","segmentId":"run_ws_seg","segmentSeq":2,"traceId":"trace_ws","artifactId":"artifact_write","spanId":"span_write","kind":"output","createdAt":"2026-06-30T10:00:00.012Z","contentType":"application/json","encoding":"json","sizeBytes":42,"preview":{"resultKind":"file","path":"/workspace/old.md","mimeType":"text/markdown","size":42,"storage":"inline"},"attributes":{"workspaceId":"drafts","operation":"write","pathHash":"fnv1a:old111","mimeType":"text/markdown","size":42}},
			{"schemaVersion":4,"recordId":"rec_rename","type":"span","runId":"run_ws","operationId":"run_ws","segmentId":"run_ws_seg","segmentSeq":3,"traceId":"trace_ws","spanId":"span_rename","family":"workspace","primitive":"workspace.operation","name":"workspace.rename","startedAt":"2026-06-30T10:00:01.000Z","endedAt":"2026-06-30T10:00:01.009Z","durationMs":9,"status":"ok","attributes":{"workspaceId":"drafts","operation":"rename","pathHash":"fnv1a:old111","namespaceHash":"ns1","mimeType":"text/markdown","size":42}},
			{"schemaVersion":4,"recordId":"artifact_rename","type":"artifact","runId":"run_ws","operationId":"run_ws","segmentId":"run_ws_seg","segmentSeq":4,"traceId":"trace_ws","artifactId":"artifact_rename","spanId":"span_rename","kind":"output","createdAt":"2026-06-30T10:00:01.009Z","contentType":"application/json","encoding":"json","sizeBytes":42,"preview":{"resultKind":"file","path":"/workspace/new.md","mimeType":"text/markdown","size":42,"storage":"inline"},"attributes":{"workspaceId":"drafts","operation":"rename","pathHash":"fnv1a:old111","mimeType":"text/markdown","size":42}}
		]
	}`), &batch); err != nil {
		t.Fatal(err)
	}
	if err := obs.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	service := NewService(st, inspect.NewService(st, t.TempDir())).WithObservability(obs)
	value, found, err := service.WorkspaceDetail(ctx, "drafts")
	if err != nil || !found {
		t.Fatalf("workspace detail found=%v err=%v", found, err)
	}
	detail := value.(workspaceDetail)
	if len(detail.Files) != 1 {
		t.Fatalf("files = %#v, want one renamed file", detail.Files)
	}
	file := detail.Files[0]
	if file.Path != "/workspace/new.md" || file.Op != "rename" {
		t.Fatalf("file = %#v, want renamed destination", file)
	}
}

func TestWorkspaceFileDetailReconstructsVersionHistoryWithoutDoubleCounting(t *testing.T) {
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
	// A write (v1), then an edit (v2). The edit emits an OUTER edit span plus a
	// nested write span — so there are three operation spans but only two
	// versions. Each version is announced by exactly one workspace.version marker.
	var batch observability.Batch
	if err := json.Unmarshal([]byte(`{
		"records": [
			{"schemaVersion":4,"recordId":"rec_w","type":"span","runId":"run","operationId":"run","segmentId":"run_seg","segmentSeq":1,"traceId":"trace_w","spanId":"span_w","family":"workspace","primitive":"workspace.operation","name":"workspace.write","startedAt":"2026-06-30T10:00:00.000Z","endedAt":"2026-06-30T10:00:00.010Z","durationMs":10,"status":"ok","attributes":{"workspaceId":"drafts","operation":"write","pathHash":"fnv1a:aaa111","namespaceHash":"ns1"}},
			{"schemaVersion":4,"recordId":"rec_vw","type":"span","runId":"run","operationId":"run","segmentId":"run_seg","segmentSeq":2,"traceId":"trace_w","spanId":"span_vw","family":"workspace","primitive":"workspace.operation","name":"workspace.version","startedAt":"2026-06-30T10:00:00.011Z","endedAt":"2026-06-30T10:00:00.011Z","durationMs":0,"status":"ok","attributes":{"workspaceId":"drafts","operation":"write","pathHash":"fnv1a:aaa111","namespaceHash":"ns1","version":1}},
			{"schemaVersion":4,"recordId":"rec_e","type":"span","runId":"run","operationId":"run","segmentId":"run_seg","segmentSeq":3,"traceId":"trace_w","spanId":"span_e","family":"workspace","primitive":"workspace.operation","name":"workspace.edit","startedAt":"2026-06-30T10:00:01.000Z","endedAt":"2026-06-30T10:00:01.020Z","durationMs":20,"status":"ok","attributes":{"workspaceId":"drafts","operation":"edit","pathHash":"fnv1a:aaa111","namespaceHash":"ns1"}},
			{"schemaVersion":4,"recordId":"rec_ew","type":"span","runId":"run","operationId":"run","segmentId":"run_seg","segmentSeq":4,"traceId":"trace_w","spanId":"span_ew","parentSpanId":"span_e","family":"workspace","primitive":"workspace.operation","name":"workspace.write","startedAt":"2026-06-30T10:00:01.002Z","endedAt":"2026-06-30T10:00:01.012Z","durationMs":10,"status":"ok","attributes":{"workspaceId":"drafts","operation":"write","pathHash":"fnv1a:aaa111","namespaceHash":"ns1"}},
			{"schemaVersion":4,"recordId":"rec_ve","type":"span","runId":"run","operationId":"run","segmentId":"run_seg","segmentSeq":5,"traceId":"trace_w","spanId":"span_ve","parentSpanId":"span_ew","family":"workspace","primitive":"workspace.operation","name":"workspace.version","startedAt":"2026-06-30T10:00:01.013Z","endedAt":"2026-06-30T10:00:01.013Z","durationMs":0,"status":"ok","attributes":{"workspaceId":"drafts","operation":"edit","pathHash":"fnv1a:aaa111","namespaceHash":"ns1","version":2}}
		]
	}`), &batch); err != nil {
		t.Fatal(err)
	}
	if err := obs.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	service := NewService(st, inspect.NewService(st, t.TempDir())).WithObservability(obs)
	value, found, err := service.WorkspaceDetail(ctx, "drafts/files/hash:fnv1a:aaa111")
	if err != nil || !found {
		t.Fatalf("workspace file detail found=%v err=%v", found, err)
	}
	detail := value.(workspaceFileDetail)

	// Two versions, newest first — the nested write span does NOT add a third.
	if len(detail.Versions) != 2 {
		t.Fatalf("versions = %#v", detail.Versions)
	}
	if detail.Versions[0].VersionID != "v2" || detail.Versions[0].Actor != "edit" {
		t.Fatalf("newest version = %#v", detail.Versions[0])
	}
	if detail.Versions[1].VersionID != "v1" || detail.Versions[1].Actor != "write" {
		t.Fatalf("oldest version = %#v", detail.Versions[1])
	}
	if detail.Versions[0].TraceID != "trace_w" {
		t.Fatalf("version trace id = %q", detail.Versions[0].TraceID)
	}
	// Version markers must not leak into the operations list.
	for _, op := range detail.Operations {
		if op.Op == "version" {
			t.Fatalf("version marker leaked into operations: %#v", detail.Operations)
		}
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
			{"schemaVersion":4,"recordId":"rec_plan_span","type":"span","runId":"run_a","operationId":"run_a","segmentId":"run_a_seg","segmentSeq":1,"traceId":"trace_a","spanId":"span_plan","family":"plan","primitive":"plan.operation","name":"plan.create","startedAt":"2026-05-21T10:00:00.000Z","endedAt":"2026-05-21T10:00:00.010Z","durationMs":10,"status":"ok","attributes":{"operation":"create","planId":"plan_123","title":"Draft plan"}},
			{"schemaVersion":4,"recordId":"rec_plan_artifact","type":"artifact","runId":"run_a","operationId":"run_a","segmentId":"run_a_seg","segmentSeq":2,"traceId":"trace_a","artifactId":"artifact_plan","spanId":"span_plan","kind":"output","createdAt":"2026-05-21T10:00:00.010Z","contentType":"application/json","encoding":"json","preview":{"primitive":"plan.operation","operation":"create","planId":"plan_123","title":"Draft plan","version":1,"content":"Full plan body","contentPreview":"Full plan body","metadata":{"status":"draft","draftId":"draft_1"}}}
		]
	}`), &batch); err != nil {
		t.Fatal(err)
	}
	if err := obs.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	service := NewService(st, inspect.NewService(st, t.TempDir())).WithObservability(obs)
	value, err := service.Plans(ctx)
	if err != nil {
		t.Fatalf("plans: %v", err)
	}
	plans := value.([]planSummary)
	if len(plans) != 1 {
		t.Fatalf("plans len = %d", len(plans))
	}
	if plans[0].ID != "plan_123" || plans[0].Title != "Draft plan" || plans[0].Status != "draft" || plans[0].ContentPreview != "Full plan body" {
		t.Fatalf("plan summary = %#v", plans[0])
	}

	value, found, err := service.PlanDetail(ctx, "plan_123")
	if err != nil || !found {
		t.Fatalf("plan detail found=%v err=%v", found, err)
	}
	detail := value.(planDetail)
	if detail.Content != "Full plan body" || len(detail.Versions) != 1 || len(detail.Events) != 1 {
		t.Fatalf("plan detail = %#v", detail)
	}
}

func TestPlanDetailProjectsObservedTaskActivity(t *testing.T) {
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
			{"schemaVersion":4,"recordId":"rec_plan_span","type":"span","runId":"run_tasks","operationId":"run_tasks","segmentId":"run_tasks_seg","segmentSeq":1,"traceId":"trace_tasks","spanId":"span_plan","family":"plan","primitive":"plan.operation","name":"plan.create","startedAt":"2026-05-21T10:00:00.000Z","endedAt":"2026-05-21T10:00:00.010Z","durationMs":10,"status":"ok","attributes":{"operation":"create","planId":"plan_tasks","title":"Task plan"}},
			{"schemaVersion":4,"recordId":"rec_plan_artifact","type":"artifact","runId":"run_tasks","operationId":"run_tasks","segmentId":"run_tasks_seg","segmentSeq":2,"traceId":"trace_tasks","artifactId":"artifact_plan","spanId":"span_plan","kind":"output","createdAt":"2026-05-21T10:00:00.010Z","contentType":"application/json","encoding":"json","preview":{"primitive":"plan.operation","operation":"create","planId":"plan_tasks","title":"Task plan","version":1,"content":"Plan body"}},

			{"schemaVersion":4,"recordId":"rec_list_span","type":"span","runId":"run_tasks","operationId":"run_tasks","segmentId":"run_tasks_seg","segmentSeq":3,"traceId":"trace_tasks","spanId":"span_list","family":"task","primitive":"task.operation","name":"tasklist.create","startedAt":"2026-05-21T10:00:01.000Z","endedAt":"2026-05-21T10:00:01.010Z","durationMs":10,"status":"ok","attributes":{"operation":"tasklist.create","taskListId":"list_1","planId":"plan_tasks"}},
			{"schemaVersion":4,"recordId":"rec_list_artifact","type":"artifact","runId":"run_tasks","operationId":"run_tasks","segmentId":"run_tasks_seg","segmentSeq":4,"traceId":"trace_tasks","artifactId":"artifact_list","spanId":"span_list","kind":"output","createdAt":"2026-05-21T10:00:01.010Z","contentType":"application/json","encoding":"json","preview":{"primitive":"task.operation","operation":"tasklist.create","taskListId":"list_1","planId":"plan_tasks","status":"in_progress"}},

			{"schemaVersion":4,"recordId":"rec_add_completed_span","type":"span","runId":"run_tasks","operationId":"run_tasks","segmentId":"run_tasks_seg","segmentSeq":5,"traceId":"trace_tasks","spanId":"span_add_completed","family":"task","primitive":"task.operation","name":"task.add","startedAt":"2026-05-21T10:00:02.000Z","endedAt":"2026-05-21T10:00:02.010Z","durationMs":10,"status":"ok","attributes":{"operation":"add","taskListId":"list_1","taskId":"completed_task"}},
			{"schemaVersion":4,"recordId":"rec_add_completed_artifact","type":"artifact","runId":"run_tasks","operationId":"run_tasks","segmentId":"run_tasks_seg","segmentSeq":6,"traceId":"trace_tasks","artifactId":"artifact_add_completed","spanId":"span_add_completed","kind":"output","createdAt":"2026-05-21T10:00:02.010Z","contentType":"application/json","encoding":"json","preview":{"primitive":"task.operation","operation":"add","taskListId":"list_1","taskId":"completed_task","label":"Completed task","status":"pending"}},
			{"schemaVersion":4,"recordId":"rec_update_completed_span","type":"span","runId":"run_tasks","operationId":"run_tasks","segmentId":"run_tasks_seg","segmentSeq":7,"traceId":"trace_tasks","spanId":"span_update_completed","family":"task","primitive":"task.operation","name":"task.update","startedAt":"2026-05-21T10:00:03.000Z","endedAt":"2026-05-21T10:00:03.010Z","durationMs":10,"status":"ok","attributes":{"operation":"update","taskListId":"list_1","taskId":"completed_task","status":"completed"}},
			{"schemaVersion":4,"recordId":"rec_update_completed_artifact","type":"artifact","runId":"run_tasks","operationId":"run_tasks","segmentId":"run_tasks_seg","segmentSeq":8,"traceId":"trace_tasks","artifactId":"artifact_update_completed","spanId":"span_update_completed","kind":"output","createdAt":"2026-05-21T10:00:03.010Z","contentType":"application/json","encoding":"json","preview":{"primitive":"task.operation","operation":"update","taskListId":"list_1","taskId":"completed_task","label":"Completed task","status":"completed","durationMs":42}},

			{"schemaVersion":4,"recordId":"rec_update_failed_span","type":"span","runId":"run_tasks","operationId":"run_tasks","segmentId":"run_tasks_seg","segmentSeq":9,"traceId":"trace_tasks","spanId":"span_update_failed","family":"task","primitive":"task.operation","name":"task.update","startedAt":"2026-05-21T10:00:04.000Z","endedAt":"2026-05-21T10:00:04.010Z","durationMs":10,"status":"ok","attributes":{"operation":"update","taskListId":"list_1","taskId":"failed_task","status":"failed"}},
			{"schemaVersion":4,"recordId":"rec_update_failed_artifact","type":"artifact","runId":"run_tasks","operationId":"run_tasks","segmentId":"run_tasks_seg","segmentSeq":10,"traceId":"trace_tasks","artifactId":"artifact_update_failed","spanId":"span_update_failed","kind":"output","createdAt":"2026-05-21T10:00:04.010Z","contentType":"application/json","encoding":"json","preview":{"primitive":"task.operation","operation":"update","taskListId":"list_1","taskId":"failed_task","label":"Failed task","status":"failed","progress":"Errored while drafting"}},

			{"schemaVersion":4,"recordId":"rec_update_skipped_span","type":"span","runId":"run_tasks","operationId":"run_tasks","segmentId":"run_tasks_seg","segmentSeq":11,"traceId":"trace_tasks","spanId":"span_update_skipped","family":"task","primitive":"task.operation","name":"task.update","startedAt":"2026-05-21T10:00:05.000Z","endedAt":"2026-05-21T10:00:05.010Z","durationMs":10,"status":"ok","attributes":{"operation":"update","taskListId":"list_1","taskId":"skipped_task","status":"skipped"}},
			{"schemaVersion":4,"recordId":"rec_update_skipped_artifact","type":"artifact","runId":"run_tasks","operationId":"run_tasks","segmentId":"run_tasks_seg","segmentSeq":12,"traceId":"trace_tasks","artifactId":"artifact_update_skipped","spanId":"span_update_skipped","kind":"output","createdAt":"2026-05-21T10:00:05.010Z","contentType":"application/json","encoding":"json","preview":{"primitive":"task.operation","operation":"update","taskListId":"list_1","taskId":"skipped_task","label":"Skipped task","status":"skipped"}},

			{"schemaVersion":4,"recordId":"rec_update_cancelled_span","type":"span","runId":"run_tasks","operationId":"run_tasks","segmentId":"run_tasks_seg","segmentSeq":13,"traceId":"trace_tasks","spanId":"span_update_cancelled","family":"task","primitive":"task.operation","name":"task.update","startedAt":"2026-05-21T10:00:06.000Z","endedAt":"2026-05-21T10:00:06.010Z","durationMs":10,"status":"ok","attributes":{"operation":"update","taskListId":"list_1","taskId":"cancelled_task","status":"cancelled"}},
			{"schemaVersion":4,"recordId":"rec_update_cancelled_artifact","type":"artifact","runId":"run_tasks","operationId":"run_tasks","segmentId":"run_tasks_seg","segmentSeq":14,"traceId":"trace_tasks","artifactId":"artifact_update_cancelled","spanId":"span_update_cancelled","kind":"output","createdAt":"2026-05-21T10:00:06.010Z","contentType":"application/json","encoding":"json","preview":{"primitive":"task.operation","operation":"update","taskListId":"list_1","taskId":"cancelled_task","label":"Cancelled task","status":"cancelled"}},

			{"schemaVersion":4,"recordId":"rec_add_removed_span","type":"span","runId":"run_tasks","operationId":"run_tasks","segmentId":"run_tasks_seg","segmentSeq":15,"traceId":"trace_tasks","spanId":"span_add_removed","family":"task","primitive":"task.operation","name":"task.add","startedAt":"2026-05-21T10:00:07.000Z","endedAt":"2026-05-21T10:00:07.010Z","durationMs":10,"status":"ok","attributes":{"operation":"add","taskListId":"list_1","taskId":"removed_task"}},
			{"schemaVersion":4,"recordId":"rec_add_removed_artifact","type":"artifact","runId":"run_tasks","operationId":"run_tasks","segmentId":"run_tasks_seg","segmentSeq":16,"traceId":"trace_tasks","artifactId":"artifact_add_removed","spanId":"span_add_removed","kind":"output","createdAt":"2026-05-21T10:00:07.010Z","contentType":"application/json","encoding":"json","preview":{"primitive":"task.operation","operation":"add","taskListId":"list_1","taskId":"removed_task","label":"Removed task","status":"pending"}},
			{"schemaVersion":4,"recordId":"rec_remove_span","type":"span","runId":"run_tasks","operationId":"run_tasks","segmentId":"run_tasks_seg","segmentSeq":17,"traceId":"trace_tasks","spanId":"span_remove","family":"task","primitive":"task.operation","name":"task.remove","startedAt":"2026-05-21T10:00:08.000Z","endedAt":"2026-05-21T10:00:08.010Z","durationMs":10,"status":"ok","attributes":{"operation":"remove","taskListId":"list_1","taskId":"removed_task"}},
			{"schemaVersion":4,"recordId":"rec_remove_artifact","type":"artifact","runId":"run_tasks","operationId":"run_tasks","segmentId":"run_tasks_seg","segmentSeq":18,"traceId":"trace_tasks","artifactId":"artifact_remove","spanId":"span_remove","kind":"output","createdAt":"2026-05-21T10:00:08.010Z","contentType":"application/json","encoding":"json","preview":{"primitive":"task.operation","operation":"remove","taskListId":"list_1","taskId":"removed_task","label":"Removed task","status":"cancelled"}},

			{"schemaVersion":4,"recordId":"rec_discard_span","type":"span","runId":"run_tasks","operationId":"run_tasks","segmentId":"run_tasks_seg","segmentSeq":19,"traceId":"trace_tasks","spanId":"span_discard","family":"task","primitive":"task.operation","name":"tasklist.discard","startedAt":"2026-05-21T10:00:09.000Z","endedAt":"2026-05-21T10:00:09.010Z","durationMs":10,"status":"ok","attributes":{"operation":"tasklist.discard","taskListId":"list_1","planId":"plan_tasks"}},
			{"schemaVersion":4,"recordId":"rec_discard_artifact","type":"artifact","runId":"run_tasks","operationId":"run_tasks","segmentId":"run_tasks_seg","segmentSeq":20,"traceId":"trace_tasks","artifactId":"artifact_discard","spanId":"span_discard","kind":"output","createdAt":"2026-05-21T10:00:09.010Z","contentType":"application/json","encoding":"json","preview":{"primitive":"task.operation","operation":"tasklist.discard","taskListId":"list_1","planId":"plan_tasks","status":"discarded"}}
		]
	}`), &batch); err != nil {
		t.Fatal(err)
	}
	if err := obs.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	service := NewService(st, inspect.NewService(st, t.TempDir())).WithObservability(obs)
	value, found, err := service.PlanDetail(ctx, "plan_tasks")
	if err != nil || !found {
		t.Fatalf("plan detail found=%v err=%v", found, err)
	}
	detail := value.(planDetail)
	statuses := map[string]string{}
	progressMessages := map[string]string{}
	for _, task := range detail.Tasks {
		statuses[task.ID] = task.Status
		progressMessages[task.ID] = task.ProgressMessage
		if task.ParentID != nil {
			t.Fatalf("task %s parentId = %q, want nil", task.ID, *task.ParentID)
		}
	}
	wantStatuses := map[string]string{
		"completed_task": "completed",
		"failed_task":    "failed",
		"skipped_task":   "skipped",
		"cancelled_task": "cancelled",
		"removed_task":   "removed",
	}
	if !reflect.DeepEqual(statuses, wantStatuses) {
		t.Fatalf("statuses = %#v, want %#v", statuses, wantStatuses)
	}
	if progressMessages["failed_task"] != "Errored while drafting" {
		t.Fatalf("progress message = %q", progressMessages["failed_task"])
	}
	if detail.TaskCounts.Done != 1 || detail.TaskCounts.Pending != 3 || detail.TaskCounts.Removed != 1 {
		t.Fatalf("task counts = %#v", detail.TaskCounts)
	}
	if len(detail.Events) == 0 || !containsPlanEventKind(detail.Events, "tasklist.discarded") {
		t.Fatalf("events missing tasklist.discarded: %#v", detail.Events)
	}
}

func containsPlanEventKind(events []planEvent, kind string) bool {
	for _, event := range events {
		if event.Kind == kind {
			return true
		}
	}
	return false
}
