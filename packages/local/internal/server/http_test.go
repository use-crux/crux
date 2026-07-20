package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/inspect"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
	"github.com/use-crux/crux/packages/local/internal/store"
	_ "modernc.org/sqlite"
)

type fakeProjectIndexer struct {
	index store.IndexData
}

type fakeIncrementalProjectIndexer struct {
	fullIndex       store.IndexData
	result          projectindex.ProjectIndexIncrementalResult
	files           []string
	deletedFiles    []string
	calledFull      bool
	calledIncrement bool
}

type fakeRuntimeProjectIndexer struct {
	fullIndex       store.IndexData
	runtimePatch    projectindex.IndexPatch
	calledRuntime   bool
	previousRuntime store.IndexData
}

func (f fakeProjectIndexer) IndexProject(context.Context, string, string, string) (store.IndexData, error) {
	return f.index, nil
}

func (f fakeProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	project := store.ProjectIdentity{}
	if f.index.Project != nil {
		project = *f.index.Project
	}
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         "ast",
		Project:       project,
		StartedAt:     f.index.IndexedAt,
		FinishedAt:    f.index.IndexedAt,
		Status:        "ok",
		Invalidates:   &projectindex.IndexPatchInvalidation{All: true},
		Facts: projectindex.IndexPatchFacts{
			Prompts:      f.index.Prompts,
			Contexts:     f.index.Contexts,
			Tools:        f.index.Tools,
			Definitions:  f.index.Definitions,
			Relations:    f.index.Relations,
			Diagnostics:  f.index.Diagnostics,
			LintFindings: f.index.LintFindings,
			Sources:      f.index.Sources,
		},
	}, nil
}

func (f *fakeIncrementalProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	f.calledFull = true
	project := store.ProjectIdentity{}
	if f.fullIndex.Project != nil {
		project = *f.fullIndex.Project
	}
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         "ast",
		Project:       project,
		Status:        "ok",
		Invalidates:   &projectindex.IndexPatchInvalidation{All: true},
		Facts: projectindex.IndexPatchFacts{
			Definitions: f.fullIndex.Definitions,
			Sources:     f.fullIndex.Sources,
		},
	}, nil
}

func (f *fakeIncrementalProjectIndexer) IndexProjectIncremental(_ context.Context, _ string, _ string, _ string, _ store.IndexData, files []string, deletedFiles []string, _ string) (projectindex.ProjectIndexIncrementalResult, error) {
	f.calledIncrement = true
	f.files = append([]string(nil), files...)
	f.deletedFiles = append([]string(nil), deletedFiles...)
	return f.result, nil
}

func (f *fakeRuntimeProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	project := store.ProjectIdentity{}
	if f.fullIndex.Project != nil {
		project = *f.fullIndex.Project
	}
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         "ast",
		Project:       project,
		Status:        "ok",
		Invalidates:   &projectindex.IndexPatchInvalidation{All: true},
		Facts: projectindex.IndexPatchFacts{
			Definitions: f.fullIndex.Definitions,
			Sources:     f.fullIndex.Sources,
		},
	}, nil
}

func (f *fakeRuntimeProjectIndexer) IndexProjectRuntimePatch(_ context.Context, req projectindex.ProjectRuntimeIndexRequest) (projectindex.IndexPatch, error) {
	f.calledRuntime = true
	f.previousRuntime = req.PreviousIndex
	return f.runtimePatch, nil
}

func newTestHTTPServer(t *testing.T, s *store.Store) http.Handler {
	t.Helper()
	return NewHTTPServer(s, ServerOptions{InspectDir: t.TempDir()})
}

func TestHTTPServer_stats_endpoint(t *testing.T) {
	s := store.NewStore()
	srv := newTestHTTPServer(t, s)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/stats")
	if err != nil {
		t.Fatalf("GET /api/stats error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}

	var stats store.StatsResult
	if err := json.NewDecoder(resp.Body).Decode(&stats); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}
	if stats.TotalExecutions != 0 {
		t.Errorf("TotalExecutions = %d, want 0", stats.TotalExecutions)
	}
}

func TestHTTPServer_collector_event_endpoint_is_absent(t *testing.T) {
	s := store.NewStore()
	srv := newTestHTTPServer(t, s)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	body := `{"type":"observability.record","runId":"r1"}`
	resp, err := http.Post(ts.URL+"/api/collector/event", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("POST status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
}

func TestHTTPServer_cors_headers(t *testing.T) {
	s := store.NewStore()
	srv := newTestHTTPServer(t, s)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	// No Origin (CLI / same-origin navigation): request succeeds and no
	// wildcard ACAO header is emitted.
	resp, err := http.Get(ts.URL + "/api/stats")
	if err != nil {
		t.Fatalf("GET error: %v", err)
	}
	defer resp.Body.Close()
	if v := resp.Header.Get("Access-Control-Allow-Origin"); v != "" {
		t.Errorf("CORS Allow-Origin = %q, want empty for no-Origin request", v)
	}

	// Loopback Origin: echoed back (devtools UI served from localhost).
	allowedReq, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/stats", nil)
	allowedReq.Header.Set("Origin", "http://localhost:5173")
	allowedResp, err := http.DefaultClient.Do(allowedReq)
	if err != nil {
		t.Fatalf("allowed-origin GET error: %v", err)
	}
	defer allowedResp.Body.Close()
	if v := allowedResp.Header.Get("Access-Control-Allow-Origin"); v != "http://localhost:5173" {
		t.Errorf("CORS Allow-Origin = %q, want http://localhost:5173", v)
	}

	// Cross-origin website: denied, no ACAO header leaked.
	deniedReq, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/stats", nil)
	deniedReq.Header.Set("Origin", "https://evil.example")
	deniedResp, err := http.DefaultClient.Do(deniedReq)
	if err != nil {
		t.Fatalf("denied-origin GET error: %v", err)
	}
	defer deniedResp.Body.Close()
	if deniedResp.StatusCode != http.StatusForbidden {
		t.Errorf("denied-origin status = %d, want %d", deniedResp.StatusCode, http.StatusForbidden)
	}
	if v := deniedResp.Header.Get("Access-Control-Allow-Origin"); v != "" {
		t.Errorf("CORS Allow-Origin = %q, want empty for denied origin", v)
	}

	// The same boundary protects local mutations such as Run Eval before the
	// coordinator can start.
	deniedMutationReq, _ := http.NewRequest(
		http.MethodPost,
		ts.URL+"/api/eval/runs",
		strings.NewReader(`{"evalId":"support","confirmUnknownCost":true}`),
	)
	deniedMutationReq.Header.Set("Content-Type", "application/json")
	deniedMutationReq.Header.Set("Origin", "https://evil.example")
	deniedMutationResp, err := http.DefaultClient.Do(deniedMutationReq)
	if err != nil {
		t.Fatalf("denied-origin Run Eval error: %v", err)
	}
	defer deniedMutationResp.Body.Close()
	if deniedMutationResp.StatusCode != http.StatusForbidden {
		t.Errorf("denied-origin Run Eval status = %d, want %d", deniedMutationResp.StatusCode, http.StatusForbidden)
	}
}

func TestHTTPServer_index_endpoint(t *testing.T) {
	s := store.NewStore()
	s.SetIndex(
		[]store.PromptMeta{{ID: "p1"}},
		[]store.ContextMeta{{ID: "c1"}},
		[]store.ToolMeta{{Name: "tool1"}},
	)

	srv := newTestHTTPServer(t, s)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/index")
	if err != nil {
		t.Fatalf("GET error: %v", err)
	}
	defer resp.Body.Close()

	var index store.IndexData
	if err := json.NewDecoder(resp.Body).Decode(&index); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}
	if len(index.Prompts) != 1 {
		t.Errorf("Prompts = %d, want 1", len(index.Prompts))
	}
}

func TestHTTPServer_index_events_endpoint(t *testing.T) {
	s := store.NewStore()
	s.IndexStart(store.IndexStartEvent{
		Timestamp:   1,
		IndexID:     "idx_1",
		IndexerID:   "project",
		Namespace:   "default",
		Operation:   "upsert",
		SourceCount: 1,
		ChunkCount:  1,
	})

	srv := newTestHTTPServer(t, s)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/index/events")
	if err != nil {
		t.Fatalf("GET error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var events []store.IndexEventData
	if err := json.NewDecoder(resp.Body).Decode(&events); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}
	if len(events) != 1 || events[0].IndexID != "idx_1" {
		t.Fatalf("events = %+v, want idx_1", events)
	}
}

func TestHTTPServer_runtime_bridge_http_peer_dispatch(t *testing.T) {
	runtimePeer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req runtimebridge.CommandRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode runtime command: %v", err)
		}
		if req.Command != "store.read" {
			t.Fatalf("command = %q, want store.read", req.Command)
		}
		writeJSON(slog.Default(), w, runtimebridge.CommandResult{
			Type:      "command.result",
			CommandID: req.CommandID,
			Result:    json.RawMessage(`{"value":{"ok":true}}`),
		})
	}))
	defer runtimePeer.Close()

	s := store.NewStore()
	bridge := runtimebridge.NewService(runtimePeer.Client())
	srv := NewHTTPServer(s, ServerOptions{InspectDir: t.TempDir(), RuntimeBridge: bridge})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	registerBody := fmt.Sprintf(`{
		"peerId":"peer_http",
		"runtimeName":"convex-dev",
		"transport":"http",
		"endpointUrl":%q,
		"capabilities":[{"command":"store.read","resources":[{"resource":"crux.store","operations":["get","list"]}]}]
	}`, runtimePeer.URL)
	resp, err := http.Post(ts.URL+"/api/runtime/bridge/peers", "application/json", strings.NewReader(registerBody))
	if err != nil {
		t.Fatalf("register peer: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("register status = %d", resp.StatusCode)
	}

	resp, err = http.Post(ts.URL+"/api/runtime/bridge/commands", "application/json", strings.NewReader(`{
		"command":"store.read",
		"payload":{"operation":"get","resource":"crux.store","key":"memory:1"}
	}`))
	if err != nil {
		t.Fatalf("dispatch command: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("dispatch status = %d body=%s", resp.StatusCode, body)
	}
	var out runtimebridge.DispatchResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode dispatch response: %v", err)
	}
	if out.PeerID != "peer_http" || string(out.Result) != `{"value":{"ok":true}}` {
		t.Fatalf("unexpected dispatch response: %#v", out)
	}
}

func TestHTTPServer_resource_inspection_capabilities_and_blackboard(t *testing.T) {
	runtimePeer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req runtimebridge.CommandRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode runtime command: %v", err)
		}
		writeJSON(slog.Default(), w, runtimebridge.CommandResult{
			Type:      "command.result",
			CommandID: req.CommandID,
			Result:    json.RawMessage(`{"value":{"content":"{\"status\":\"ready\"}"}}`),
		})
	}))
	defer runtimePeer.Close()

	s := store.NewStore()
	bridge := runtimebridge.NewService(runtimePeer.Client())
	bridge.RegisterPeer(runtimebridge.Peer{
		PeerID:      "peer_http",
		RuntimeName: "convex-dev",
		Transport:   runtimebridge.TransportHTTP,
		EndpointURL: runtimePeer.URL,
		Capabilities: []runtimebridge.Capability{{
			Command:   "store.read",
			Resources: []runtimebridge.StoreResource{{Resource: "crux.store", Operations: []string{"get", "list"}}},
		}},
	}, nil)
	srv := NewHTTPServer(s, ServerOptions{InspectDir: t.TempDir(), RuntimeBridge: bridge})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/resources/capabilities")
	if err != nil {
		t.Fatalf("get capabilities: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("capabilities status = %d", resp.StatusCode)
	}
	var caps map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&caps); err != nil {
		t.Fatalf("decode capabilities: %v", err)
	}
	features := caps["features"].(map[string]any)
	if features["blackboardInspect"] != true || features["liveStoreRead"] != true {
		t.Fatalf("unexpected capabilities: %+v", caps)
	}

	resp, err = http.Get(ts.URL + "/api/resources/blackboard:thread:abc")
	if err != nil {
		t.Fatalf("get blackboard: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("blackboard status = %d body=%s", resp.StatusCode, body)
	}
	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("decode result: %v", err)
	}
	if result["status"] != "ok" || result["source"] != "runtime_bridge" || result["kind"] != "blackboard" {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestHTTPServer_resource_inspection_unavailable_without_bridge(t *testing.T) {
	s := store.NewStore()
	srv := NewHTTPServer(s, ServerOptions{InspectDir: t.TempDir(), RuntimeBridge: runtimebridge.NewService(nil)})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/resources/blackboard:thread:abc")
	if err != nil {
		t.Fatalf("get blackboard: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("decode result: %v", err)
	}
	if result["status"] != "unavailable" || result["reason"] != "bridge_required" || result["docsUrl"] == "" {
		t.Fatalf("unexpected unavailable result: %+v", result)
	}
}

func TestHTTPServer_index_snapshot_endpoint(t *testing.T) {
	s := store.NewStore()
	srv := newTestHTTPServer(t, s)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	body := `{
		"schemaVersion": 1,
		"prompts": [{
			"id": "p1",
			"description": "Prompt one",
			"tags": ["support"],
			"contextIds": ["c1"],
			"hasOutput": true,
			"settings": {"temperature": 0.2},
			"systemTemplate": "system",
			"promptTemplate": "prompt"
		}],
		"contexts": [{
			"id": "c1",
			"description": "Context one",
			"priority": 5,
			"isStatic": true,
			"usedBy": ["p1"],
			"systemTemplate": "context"
		}],
		"tools": [{
			"name": "lookup",
			"description": "Lookup account"
		}]
	}`
	resp, err := http.Post(ts.URL+"/api/index/snapshot", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST index snapshot error: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("POST status = %d, want %d", resp.StatusCode, http.StatusNoContent)
	}

	resp, err = http.Get(ts.URL + "/api/index")
	if err != nil {
		t.Fatalf("GET index error: %v", err)
	}
	defer resp.Body.Close()

	var index store.IndexData
	if err := json.NewDecoder(resp.Body).Decode(&index); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}
	if len(index.Prompts) != 1 || index.Prompts[0].ID != "p1" || !index.Prompts[0].HasOutput {
		t.Fatalf("prompts = %+v, want p1 with hasOutput", index.Prompts)
	}
	if string(index.Prompts[0].Settings) != `{"temperature":0.2}` {
		t.Fatalf("settings = %s, want temperature", index.Prompts[0].Settings)
	}
	if len(index.Contexts) != 1 || index.Contexts[0].ID != "c1" || !index.Contexts[0].IsStatic {
		t.Fatalf("contexts = %+v, want c1 static", index.Contexts)
	}
	if len(index.Tools) != 1 || index.Tools[0].Name != "lookup" {
		t.Fatalf("tools = %+v, want lookup", index.Tools)
	}
}

func TestHTTPServer_project_index_reindex_endpoint(t *testing.T) {
	dir := t.TempDir()
	s := store.NewStore()
	devSvc := devtools.NewService(s, inspect.NewService(s, inspect.Dir(dir))).WithProjectIndexer(fakeProjectIndexer{
		index: store.IndexData{
			SchemaVersion: 1,
			Prompts:       []store.PromptMeta{{ID: "p1", Tags: []string{}, ContextIDs: []string{}, HasOutput: false, Settings: json.RawMessage(`{}`)}},
			Contexts:      []store.ContextMeta{},
			Tools:         []store.ToolMeta{},
			Project:       &store.ProjectIdentity{Root: "/tmp/project", ConfigFile: "/tmp/project/crux.config.ts"},
			IndexedAt:     "2026-05-25T00:00:00.000Z",
			Definitions: []store.ProjectDefinition{
				{ID: "prompt:p1", Kind: "prompt", Name: "p1", Fidelity: "resolved", Status: "active", Fingerprint: "fp-new"},
				{ID: "eval:p1", Kind: "eval", Name: "p1 eval", Fidelity: "resolved", Status: "active"},
				{ID: "eval.case:p1:refund", Kind: "eval.case", Name: "refund", Fidelity: "resolved", Status: "active"},
			},
			Relations: []store.ProjectRelation{
				{ID: "relation:eval:p1", Type: "eval.covers_definition", From: "eval:p1", To: "prompt:p1", Fidelity: "resolved"},
				{ID: "relation:eval-case:p1", Type: "eval.includes_case", From: "eval:p1", To: "eval.case:p1:refund", Fidelity: "resolved"},
			},
			Diagnostics: []store.IndexDiagnostic{},
			Sources:     []store.IndexSourceFile{{File: "/tmp/project/crux.config.ts", Status: "indexed"}},
		},
	})
	srv := NewHTTPServerWithServices(devSvc, ServerOptions{InspectDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Post(ts.URL+"/api/project/index/reindex", "application/json", strings.NewReader(`{"root":"/tmp/project"}`))
	if err != nil {
		t.Fatalf("POST reindex error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("POST status = %d, want %d: %s", resp.StatusCode, http.StatusOK, body)
	}
	resp, err = http.Post(ts.URL+"/api/index/reindex", "application/json", strings.NewReader(`{"root":"/tmp/project"}`))
	if err != nil {
		t.Fatalf("POST /api/index/reindex error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("POST /api/index/reindex status = %d, want %d: %s", resp.StatusCode, http.StatusOK, body)
	}

	resp, err = http.Get(ts.URL + "/api/project/index")
	if err != nil {
		t.Fatalf("GET project index error: %v", err)
	}
	defer resp.Body.Close()
	var index store.IndexData
	if err := json.NewDecoder(resp.Body).Decode(&index); err != nil {
		t.Fatalf("decode project index: %v", err)
	}
	if index.Project == nil || index.Project.ConfigFile != "/tmp/project/crux.config.ts" {
		t.Fatalf("project = %+v, want indexed project identity", index.Project)
	}
	prompt := indexDefinitionByID(index.Definitions, "prompt:p1")
	if prompt == nil {
		t.Fatalf("definitions = %+v, want prompt:p1", index.Definitions)
	}
}

func TestHTTPServer_project_index_reindex_endpoint_accepts_runtime_rich(t *testing.T) {
	root := t.TempDir()
	s := store.NewStore()
	indexer := &fakeRuntimeProjectIndexer{
		fullIndex: store.IndexData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: root, Name: "project"},
			Definitions: []store.ProjectDefinition{
				{ID: "prompt:ast", Kind: "prompt", Name: "ast", Fidelity: "partial", Status: "active"},
			},
		},
		runtimePatch: projectindex.IndexPatch{
			SchemaVersion: 1,
			Phase:         "runtime",
			Project:       store.ProjectIdentity{Root: root, Name: "project"},
			Status:        "ok",
			Facts: projectindex.IndexPatchFacts{
				Definitions: []store.ProjectDefinition{
					{ID: "prompt:runtime", Kind: "prompt", Name: "runtime", Fidelity: "resolved", Status: "active"},
				},
			},
		},
	}
	devSvc := devtools.NewService(s, inspect.NewService(s, inspect.Dir(t.TempDir()))).WithProjectIndexer(indexer)
	srv := NewHTTPServerWithServices(devSvc, ServerOptions{InspectDir: t.TempDir()})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	body := fmt.Sprintf(`{"root":%q,"runtimeRich":true}`, root)
	resp, err := http.Post(ts.URL+"/api/project/index/reindex", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST runtime-rich reindex error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		responseBody, _ := io.ReadAll(resp.Body)
		t.Fatalf("POST runtime-rich reindex status = %d, want 200: %s", resp.StatusCode, responseBody)
	}
	var index store.IndexData
	if err := json.NewDecoder(resp.Body).Decode(&index); err != nil {
		t.Fatalf("decode runtime-rich index: %v", err)
	}
	if !indexer.calledRuntime {
		t.Fatal("runtime indexer was not called")
	}
	if indexDefinitionByID(indexer.previousRuntime.Definitions, "prompt:ast") == nil {
		t.Fatalf("previous runtime index = %+v, want AST definition", indexer.previousRuntime.Definitions)
	}
	if indexDefinitionByID(index.Definitions, "prompt:ast") == nil || indexDefinitionByID(index.Definitions, "prompt:runtime") == nil {
		t.Fatalf("definitions = %+v, want AST and runtime definitions", index.Definitions)
	}
}

func TestHTTPServer_project_index_reindex_endpoint_accepts_incremental_deltas(t *testing.T) {
	root := t.TempDir()
	s := store.NewStore()
	previous := store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "project"},
		SourceGraph: &store.ProjectIndexSourceGraph{
			SchemaVersion: 1,
			ProducedBy:    "@use-crux/indexer",
			Capabilities:  []string{"source-dependencies", "source-dependents", "definition-ownership", "diagnostic-ownership", "project-shards"},
			Shards:        []store.ProjectIndexShard{{ID: ".", Root: root}},
		},
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:old", Kind: "prompt", Name: "old", Fidelity: "resolved", Status: "active", Source: &store.SourceLoc{File: "src/a.ts", Line: 1}},
			{ID: "prompt:kept", Kind: "prompt", Name: "kept", Fidelity: "resolved", Status: "active", Source: &store.SourceLoc{File: "src/b.ts", Line: 1}},
		},
		Sources: []store.IndexSourceFile{
			{File: "src/a.ts", Status: "active", ShardID: ".", DefinitionIDs: []string{"prompt:old"}},
			{File: "src/b.ts", Status: "active", ShardID: ".", DefinitionIDs: []string{"prompt:kept"}},
		},
	}
	indexer := &fakeIncrementalProjectIndexer{
		result: projectindex.ProjectIndexIncrementalResult{
			Report: projectindex.ProjectIndexIncrementalReport{PlanKind: "source-file-reindex"},
			Patches: []projectindex.IndexPatch{
				{
					SchemaVersion: 1,
					Phase:         "ast",
					Project:       store.ProjectIdentity{Root: root, Name: "project"},
					Status:        "ok",
					Invalidates:   &projectindex.IndexPatchInvalidation{Files: []string{"src/a.ts"}},
					Facts: projectindex.IndexPatchFacts{
						Definitions: []store.ProjectDefinition{
							{ID: "prompt:new", Kind: "prompt", Name: "new", Fidelity: "resolved", Status: "active", Source: &store.SourceLoc{File: "src/a.ts", Line: 2}},
						},
						Sources: []store.IndexSourceFile{
							{File: "src/a.ts", Status: "active", DefinitionIDs: []string{"prompt:new"}},
						},
					},
				},
			},
		},
	}
	devSvc := devtools.NewService(s, inspect.NewService(s, inspect.Dir(t.TempDir()))).WithProjectIndexer(indexer)
	devSvc.ApplyIndexPatch(context.Background(), projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         "ast",
		Project:       *previous.Project,
		Status:        "ok",
		Invalidates:   &projectindex.IndexPatchInvalidation{All: true},
		Facts: projectindex.IndexPatchFacts{
			Definitions: previous.Definitions,
			Sources:     previous.Sources,
			SourceGraph: previous.SourceGraph,
		},
	})
	srv := NewHTTPServerWithServices(devSvc, ServerOptions{InspectDir: t.TempDir()})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	body := fmt.Sprintf(`{"root":%q,"files":["src/a.ts"],"deletedFiles":["src/deleted.ts"]}`, root)
	resp, err := http.Post(ts.URL+"/api/project/index/reindex", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST incremental reindex error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		responseBody, _ := io.ReadAll(resp.Body)
		t.Fatalf("POST incremental reindex status = %d, want 200: %s", resp.StatusCode, responseBody)
	}
	var index store.IndexData
	if err := json.NewDecoder(resp.Body).Decode(&index); err != nil {
		t.Fatalf("decode incremental index: %v", err)
	}
	if !indexer.calledIncrement {
		t.Fatal("incremental indexer was not called")
	}
	if indexer.calledFull {
		t.Fatal("full indexer was called for delta request")
	}
	if !containsString(indexer.files, "src/a.ts") || !containsString(indexer.deletedFiles, "src/deleted.ts") {
		t.Fatalf("files = %v deleted = %v, want forwarded delta arrays", indexer.files, indexer.deletedFiles)
	}
	if indexDefinitionByID(index.Definitions, "prompt:old") != nil {
		t.Fatalf("stale definition survived incremental HTTP reindex: %+v", index.Definitions)
	}
	if indexDefinitionByID(index.Definitions, "prompt:new") == nil {
		t.Fatalf("replacement definition missing after incremental HTTP reindex: %+v", index.Definitions)
	}
	if indexDefinitionByID(index.Definitions, "prompt:kept") == nil {
		t.Fatalf("unrelated definition removed after incremental HTTP reindex: %+v", index.Definitions)
	}
}

func TestHTTPServerDoesNotExposeRetiredInspectFeedbackRoutes(t *testing.T) {
	srv := NewHTTPServer(store.NewStore(), ServerOptions{InspectDir: t.TempDir()})
	server := httptest.NewServer(srv)
	defer server.Close()

	for _, path := range []string{
		"/api/inspect/feedback",
		"/api/inspect/feedback/annotations",
		"/api/inspect/feedback/memory-proposals",
	} {
		response, err := http.Get(server.URL + path)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s status = %d, want %d", path, response.StatusCode, http.StatusNotFound)
		}
	}
}
func TestHTTPServer_inspect_runs_read_observability(t *testing.T) {
	dir := t.TempDir()
	srv := newObservabilityHTTPServer(t, dir,
		`{"schemaVersion":4,"recordId":"run-start-1","type":"run:start","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":1,"traceId":"tr-1","name":"support","rootPrimitive":"generation.call","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":4,"recordId":"span-start-1","type":"span:start","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":2,"traceId":"tr-1","spanId":"span-1","family":"generation","primitive":"generation.call","name":"support","startedAt":"2026-05-16T18:00:00.001Z","status":"running","model":"gpt-4o","provider":"openai","promptId":"support"}`,
		`{"schemaVersion":4,"recordId":"tool-start-1","type":"span:start","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":3,"traceId":"tr-1","spanId":"tool-1","parentSpanId":"span-1","family":"tool","primitive":"tool.call","name":"searchDocs","startedAt":"2026-05-16T18:00:00.010Z","status":"running","toolName":"searchDocs"}`,
		`{"schemaVersion":4,"recordId":"tool-end-1","type":"span:end","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":4,"traceId":"tr-1","spanId":"tool-1","endedAt":"2026-05-16T18:00:00.020Z","durationMs":10,"status":"ok"}`,
		`{"schemaVersion":4,"recordId":"span-end-1","type":"span:end","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":5,"traceId":"tr-1","spanId":"span-1","endedAt":"2026-05-16T18:00:00.042Z","durationMs":41,"status":"ok","metrics":{"inputTokens":10,"outputTokens":12,"totalTokens":22,"costUsd":0.02}}`,
		`{"schemaVersion":4,"recordId":"run-end-1","type":"run:end","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":6,"traceId":"tr-1","endedAt":"2026-05-16T18:00:00.043Z","durationMs":43,"status":"ok","metrics":{"inputTokens":10,"outputTokens":12,"totalTokens":22,"costUsd":0.02}}`,
	)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/inspect/runs")
	if err != nil {
		t.Fatalf("GET /api/inspect/runs error: %v", err)
	}
	defer resp.Body.Close()

	var runs []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&runs); err != nil {
		t.Fatalf("decode runs: %v", err)
	}
	if len(runs) != 1 {
		t.Fatalf("runs len = %d, want 1", len(runs))
	}
	run := runs[0]
	if run["operationId"] != "run-1" || run["traceId"] != "tr-1" || run["targetId"] != "support" || run["toolCallCount"] != float64(1) {
		t.Fatalf("run = %#v", run)
	}
	if run["tokenCount"] != float64(22) {
		t.Fatalf("run token fields = %#v", run)
	}
}

func TestHTTPServer_inspect_delete_runs_removes_observability(t *testing.T) {
	dir := t.TempDir()
	srv := newObservabilityHTTPServer(t, dir,
		`{"schemaVersion":4,"recordId":"run-start-1","type":"run:start","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":1,"traceId":"trace-1","name":"support","rootPrimitive":"generation.call","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":4,"recordId":"span-start-1","type":"span:start","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":2,"traceId":"trace-1","spanId":"span-1","family":"generation","primitive":"generation.call","name":"support","startedAt":"2026-05-16T18:00:00.001Z","status":"running"}`,
		`{"schemaVersion":4,"recordId":"span-event-1","type":"span:event","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":3,"traceId":"trace-1","spanId":"span-1","eventId":"event-1","name":"token.chunk","timestamp":"2026-05-16T18:00:00.002Z","attributes":{"chunkIndex":0,"charCount":2,"text":"ok","firstDeltaAt":"2026-05-16T18:00:00.001Z","lastDeltaAt":"2026-05-16T18:00:00.002Z"}}`,
		`{"schemaVersion":4,"recordId":"artifact-1","type":"artifact","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":4,"traceId":"trace-1","artifactId":"artifact-1","spanId":"span-1","kind":"output","createdAt":"2026-05-16T18:00:00.003Z","contentType":"application/json","encoding":"json","preview":{"text":"ok"}}`,
		`{"schemaVersion":4,"recordId":"edge-1","type":"edge","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":5,"traceId":"trace-1","edgeId":"edge-1","edgeType":"produced","from":{"kind":"span","id":"span-1"},"to":{"kind":"artifact","id":"artifact-1"},"createdAt":"2026-05-16T18:00:00.004Z"}`,
		`{"schemaVersion":4,"recordId":"run-end-1","type":"run:end","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":6,"traceId":"trace-1","endedAt":"2026-05-16T18:00:00.010Z","durationMs":10,"status":"ok"}`,
		`{"schemaVersion":4,"recordId":"run-start-2","type":"run:start","runId":"run-2","operationId":"run-2","segmentId":"run-2_seg","segmentSeq":1,"traceId":"trace-2","name":"writer","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:01:00.000Z","status":"running"}`,
		`{"schemaVersion":4,"recordId":"run-end-2","type":"run:end","runId":"run-2","operationId":"run-2","segmentId":"run-2_seg","segmentSeq":2,"traceId":"trace-2","endedAt":"2026-05-16T18:01:00.010Z","durationMs":10,"status":"ok"}`,
	)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	req, err := http.NewRequest(http.MethodDelete, ts.URL+"/api/inspect/runs/run-1", nil)
	if err != nil {
		t.Fatalf("create delete request: %v", err)
	}
	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatalf("DELETE /api/inspect/runs/run-1 error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("single delete status = %d body %s", resp.StatusCode, body)
	}
	var single map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&single); err != nil {
		t.Fatalf("decode single delete: %v", err)
	}
	if got := single["deletedOperationIds"].([]any); len(got) != 1 || got[0] != "run-1" {
		t.Fatalf("single deletedOperationIds = %#v", got)
	}

	resp, err = http.Get(ts.URL + "/api/inspect/runs/run-1")
	if err != nil {
		t.Fatalf("GET deleted run detail error: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("deleted run detail status = %d, want 404", resp.StatusCode)
	}

	bulkBody := strings.NewReader(`{"operationIds":["run-2","missing-run"]}`)
	req, err = http.NewRequest(http.MethodDelete, ts.URL+"/api/inspect/runs", bulkBody)
	if err != nil {
		t.Fatalf("create bulk delete request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err = ts.Client().Do(req)
	if err != nil {
		t.Fatalf("DELETE /api/inspect/runs error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("bulk delete status = %d body %s", resp.StatusCode, body)
	}
	var bulk map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&bulk); err != nil {
		t.Fatalf("decode bulk delete: %v", err)
	}
	if got := bulk["deletedOperationIds"].([]any); len(got) != 1 || got[0] != "run-2" {
		t.Fatalf("bulk deletedOperationIds = %#v", got)
	}
	if got := bulk["missingOperationIds"].([]any); len(got) != 1 || got[0] != "missing-run" {
		t.Fatalf("bulk missingOperationIds = %#v", got)
	}
}

func TestHTTPServer_inspect_insight_silences_create_list_delete(t *testing.T) {
	dir := t.TempDir()
	srv := newObservabilityHTTPServer(t, dir,
		`{"schemaVersion":4,"recordId":"run-start-1","type":"run:start","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":1,"traceId":"run-1","name":"support-agent","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running","metrics":{"totalTokens":12000}}`,
		`{"schemaVersion":4,"recordId":"span-1","type":"span","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":2,"traceId":"run-1","spanId":"span-1","family":"generation","primitive":"generation.call","name":"support-agent","startedAt":"2026-05-16T18:00:00.001Z","endedAt":"2026-05-16T18:00:00.009Z","durationMs":8,"status":"ok","metrics":{"totalTokens":12000}}`,
		`{"schemaVersion":4,"recordId":"run-end-1","type":"run:end","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":3,"traceId":"run-1","endedAt":"2026-05-16T18:00:00.010Z","durationMs":10,"status":"ok"}`,
	)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	body := `{"insightId":"high-token-usage-run-1","note":"Expected in this fixture."}`
	resp, err := http.Post(ts.URL+"/api/inspect/insights/silences", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST silence error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		data, _ := io.ReadAll(resp.Body)
		t.Fatalf("POST silence status = %d, want 201: %s", resp.StatusCode, string(data))
	}
	var silence map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&silence); err != nil {
		t.Fatalf("decode silence: %v", err)
	}
	silenceID := silence["id"].(string)
	pattern := silence["pattern"].(map[string]any)
	if pattern["title"] != "Run has high token usage" || pattern["targetId"] != "support-agent" {
		t.Fatalf("silence = %#v, want pattern from insight", silence)
	}

	resp, err = http.Get(ts.URL + "/api/inspect/insights")
	if err != nil {
		t.Fatalf("GET silenced insights error: %v", err)
	}
	defer resp.Body.Close()
	var insights []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&insights); err != nil {
		t.Fatalf("decode silenced insights: %v", err)
	}
	for _, insight := range insights {
		if insight["insightId"] == "high-token-usage-run-1" {
			t.Fatalf("insights = %#v, want high-token insight silenced", insights)
		}
	}

	resp, err = http.Get(ts.URL + "/api/inspect/insights/silences")
	if err != nil {
		t.Fatalf("GET silences error: %v", err)
	}
	defer resp.Body.Close()
	var silences []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&silences); err != nil {
		t.Fatalf("decode silences: %v", err)
	}
	if len(silences) != 1 || silences[0]["id"] != silenceID {
		t.Fatalf("silences = %#v, want active silence", silences)
	}

	req, err := http.NewRequest(http.MethodDelete, ts.URL+"/api/inspect/insights/silences/"+silenceID, nil)
	if err != nil {
		t.Fatalf("create delete silence request: %v", err)
	}
	resp, err = ts.Client().Do(req)
	if err != nil {
		t.Fatalf("DELETE silence error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		data, _ := io.ReadAll(resp.Body)
		t.Fatalf("DELETE silence status = %d, want 200: %s", resp.StatusCode, string(data))
	}

	resp, err = http.Get(ts.URL + "/api/inspect/insights")
	if err != nil {
		t.Fatalf("GET restored insights error: %v", err)
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(&insights); err != nil {
		t.Fatalf("decode restored insights: %v", err)
	}
	found := false
	for _, insight := range insights {
		if insight["insightId"] == "high-token-usage-run-1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("insights = %#v, want deleted silence to restore insight", insights)
	}
}

func TestHTTPServer_inspect_overview_endpoint_returns_workbench_counts(t *testing.T) {
	dir := t.TempDir()
	srv := newObservabilityHTTPServer(t, dir,
		`{"schemaVersion":4,"recordId":"run-start-1","type":"run:start","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":1,"traceId":"tr-1","name":"support","rootPrimitive":"generation.call","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":4,"recordId":"span-start-1","type":"span:start","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":2,"traceId":"tr-1","spanId":"span-1","family":"generation","primitive":"generation.call","name":"support","startedAt":"2026-05-16T18:00:00.001Z","status":"running","model":"gpt-4o","provider":"openai","promptId":"support"}`,
		`{"schemaVersion":4,"recordId":"span-end-1","type":"span:end","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":3,"traceId":"tr-1","spanId":"span-1","endedAt":"2026-05-16T18:00:00.042Z","durationMs":41,"status":"ok"}`,
		`{"schemaVersion":4,"recordId":"run-end-1","type":"run:end","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":4,"traceId":"tr-1","endedAt":"2026-05-16T18:00:00.043Z","durationMs":43,"status":"ok"}`,
	)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/inspect/overview")
	if err != nil {
		t.Fatalf("GET /api/inspect/overview error: %v", err)
	}
	defer resp.Body.Close()

	var overview map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&overview); err != nil {
		t.Fatalf("decode overview: %v", err)
	}
	if overview["runCount"] != float64(1) {
		t.Fatalf("overview counts = %#v", overview)
	}
	for _, removed := range []string{"experimentCount", "baselineCount", "cassetteCount"} {
		if _, ok := overview[removed]; ok {
			t.Fatalf("legacy field %q leaked into Inspect overview: %#v", removed, overview)
		}
	}
}

func TestHTTPServer_inspect_overview_endpoint_returns_design_kpis(t *testing.T) {
	dir := t.TempDir()

	srv := newObservabilityHTTPServer(t, dir,
		`{"schemaVersion":4,"recordId":"run-start-1","type":"run:start","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":1,"traceId":"tr-1","name":"support","rootPrimitive":"generation.call","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":4,"recordId":"span-start-1","type":"span:start","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":2,"traceId":"tr-1","spanId":"span-1","family":"generation","primitive":"generation.call","name":"support","startedAt":"2026-05-16T18:00:00.001Z","status":"running","model":"gpt-4o","provider":"openai","promptId":"support"}`,
		`{"schemaVersion":4,"recordId":"span-end-1","type":"span:end","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":3,"traceId":"tr-1","spanId":"span-1","endedAt":"2026-05-16T18:00:00.100Z","durationMs":100,"status":"ok","metrics":{"totalTokens":10,"costUsd":0.2}}`,
		`{"schemaVersion":4,"recordId":"run-end-1","type":"run:end","runId":"run-1","operationId":"run-1","segmentId":"run-1_seg","segmentSeq":4,"traceId":"tr-1","endedAt":"2026-05-16T18:00:00.100Z","durationMs":100,"status":"ok","metrics":{"totalTokens":10,"costUsd":0.2}}`,
		`{"schemaVersion":4,"recordId":"run-start-2","type":"run:start","runId":"run-2","operationId":"run-2","segmentId":"run-2_seg","segmentSeq":1,"traceId":"tr-2","name":"support","rootPrimitive":"generation.call","startedAt":"2026-05-16T18:00:01.000Z","status":"running"}`,
		`{"schemaVersion":4,"recordId":"span-start-2","type":"span:start","runId":"run-2","operationId":"run-2","segmentId":"run-2_seg","segmentSeq":2,"traceId":"tr-2","spanId":"span-2","family":"generation","primitive":"generation.call","name":"support","startedAt":"2026-05-16T18:00:01.001Z","status":"running","model":"gpt-4o","provider":"openai","promptId":"support"}`,
		`{"schemaVersion":4,"recordId":"span-end-2","type":"span:end","runId":"run-2","operationId":"run-2","segmentId":"run-2_seg","segmentSeq":3,"traceId":"tr-2","spanId":"span-2","endedAt":"2026-05-16T18:00:01.300Z","durationMs":300,"status":"error","metrics":{"totalTokens":20,"costUsd":0.3}}`,
		`{"schemaVersion":4,"recordId":"run-end-2","type":"run:end","runId":"run-2","operationId":"run-2","segmentId":"run-2_seg","segmentSeq":4,"traceId":"tr-2","endedAt":"2026-05-16T18:00:01.300Z","durationMs":300,"status":"error","metrics":{"totalTokens":20,"costUsd":0.3}}`,
	)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/inspect/overview")
	if err != nil {
		t.Fatalf("GET /api/inspect/overview error: %v", err)
	}
	defer resp.Body.Close()

	var overview map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&overview); err != nil {
		t.Fatalf("decode overview: %v", err)
	}
	if overview["passRate"] != 0.5 || overview["totalCost"] != 0.5 || overview["p50LatencyMs"] != 100.0 {
		t.Fatalf("overview KPIs = %#v", overview)
	}
	recentRuns := overview["recentRuns"].([]any)
	if len(recentRuns) != 2 {
		t.Fatalf("recentRuns len = %d, want 2", len(recentRuns))
	}
}

func newObservabilityHTTPServer(t *testing.T, inspectDir string, records ...string) http.Handler {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	obs, err := observability.NewService(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) > 0 {
		batch := observabilityBatch(t, records...)
		if err := obs.Ingest(context.Background(), batch); err != nil {
			t.Fatal(err)
		}
	}
	return NewHTTPServer(store.NewStore(), ServerOptions{InspectDir: inspectDir, ObservabilityService: obs})
}

func observabilityBatch(t *testing.T, records ...string) observability.Batch {
	t.Helper()
	raw := `{"records":[` + strings.Join(records, ",") + `]}`
	var batch observability.Batch
	if err := json.Unmarshal([]byte(raw), &batch); err != nil {
		t.Fatalf("observability fixture: %v", err)
	}
	return batch
}

func indexDefinitionByID(definitions []store.ProjectDefinition, id string) *store.ProjectDefinition {
	for i := range definitions {
		if definitions[i].ID == id {
			return &definitions[i]
		}
	}
	return nil
}

func containsString(values []string, value string) bool {
	for _, existing := range values {
		if existing == value {
			return true
		}
	}
	return false
}

func TestHTTPServer_trace_routes_are_absent(t *testing.T) {
	s := store.NewStore()
	srv := newTestHTTPServer(t, s)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/traces/t1")
	if err != nil {
		t.Fatalf("GET error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestHTTPServer_traces_list_route_is_absent(t *testing.T) {
	s := store.NewStore()
	srv := newTestHTTPServer(t, s)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/traces")
	if err != nil {
		t.Fatalf("GET error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}
