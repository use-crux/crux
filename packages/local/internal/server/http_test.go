package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
	"github.com/use-crux/crux/packages/local/internal/store"
	_ "modernc.org/sqlite"
)

type fakeProjectIndexer struct {
	index store.IndexData
}

type fakeIncrementalProjectIndexer struct {
	fullIndex       store.IndexData
	result          devtools.ProjectIndexIncrementalResult
	files           []string
	deletedFiles    []string
	calledFull      bool
	calledIncrement bool
}

func (f fakeProjectIndexer) IndexProject(context.Context, string, string, string) (store.IndexData, error) {
	return f.index, nil
}

func (f fakeProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string, bool) (devtools.IndexPatch, error) {
	project := store.ProjectIdentity{}
	if f.index.Project != nil {
		project = *f.index.Project
	}
	return devtools.IndexPatch{
		SchemaVersion: 1,
		Phase:         "ast",
		Project:       project,
		StartedAt:     f.index.IndexedAt,
		FinishedAt:    f.index.IndexedAt,
		Status:        "ok",
		Invalidates:   &devtools.IndexPatchInvalidation{All: true},
		Facts: devtools.IndexPatchFacts{
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

func (f *fakeIncrementalProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string, bool) (devtools.IndexPatch, error) {
	f.calledFull = true
	project := store.ProjectIdentity{}
	if f.fullIndex.Project != nil {
		project = *f.fullIndex.Project
	}
	return devtools.IndexPatch{
		SchemaVersion: 1,
		Phase:         "ast",
		Project:       project,
		Status:        "ok",
		Invalidates:   &devtools.IndexPatchInvalidation{All: true},
		Facts: devtools.IndexPatchFacts{
			Definitions: f.fullIndex.Definitions,
			Sources:     f.fullIndex.Sources,
		},
	}, nil
}

func (f *fakeIncrementalProjectIndexer) IndexProjectIncremental(_ context.Context, _ string, _ string, _ string, _ store.IndexData, files []string, deletedFiles []string, _ string) (devtools.ProjectIndexIncrementalResult, error) {
	f.calledIncrement = true
	f.files = append([]string(nil), files...)
	f.deletedFiles = append([]string(nil), deletedFiles...)
	return f.result, nil
}

func newTestHTTPServer(t *testing.T, s *store.Store) http.Handler {
	t.Helper()
	return NewHTTPServer(s, ServerOptions{QualityDir: t.TempDir()})
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
		writeJSON(w, runtimebridge.CommandResult{
			Type:      "command.result",
			CommandID: req.CommandID,
			Result:    json.RawMessage(`{"value":{"ok":true}}`),
		})
	}))
	defer runtimePeer.Close()

	s := store.NewStore()
	bridge := runtimebridge.NewService(runtimePeer.Client())
	srv := NewHTTPServer(s, ServerOptions{QualityDir: t.TempDir(), RuntimeBridge: bridge})
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
		writeJSON(w, runtimebridge.CommandResult{
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
	srv := NewHTTPServer(s, ServerOptions{QualityDir: t.TempDir(), RuntimeBridge: bridge})
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
	srv := NewHTTPServer(s, ServerOptions{QualityDir: t.TempDir(), RuntimeBridge: runtimebridge.NewService(nil)})
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
	writeQualityRecordFixture(t, dir, "experiments", "exp-1", `{
		"_tag":"Experiment",
		"id":"exp-1",
		"qualityId":"q",
		"suite":{"id":"suite-1","caseCount":1},
		"startedAt":"2026-05-25T10:00:00Z",
		"endedAt":"2026-05-25T10:01:00Z",
		"status":"completed",
		"summary":{"total":1,"passed":1,"failed":0,"errored":0},
		"variants":[{"id":"candidate","targetId":"p1","definitionFingerprint":"fp-old"}],
		"cases":[{"caseId":"case-1","variantId":"candidate","status":"passed","traceId":"trace-1"}]
	}`)
	writeQualityRecordFixture(t, dir, "baselines", "baseline-1", `{
		"_tag":"QualityBaseline",
		"id":"baseline-1",
		"qualityId":"q",
		"experimentId":"exp-1",
		"variantId":"candidate"
	}`)
	s := store.NewStore()
	devSvc := devtools.NewService(s, quality.NewService(s, quality.Dir(dir))).WithProjectIndexer(fakeProjectIndexer{
		index: store.IndexData{
			SchemaVersion: 1,
			Prompts:       []store.PromptMeta{{ID: "p1", Tags: []string{}, ContextIDs: []string{}, HasOutput: false, Settings: json.RawMessage(`{}`)}},
			Contexts:      []store.ContextMeta{},
			Tools:         []store.ToolMeta{},
			Project:       &store.ProjectIdentity{Root: "/tmp/project", ConfigFile: "/tmp/project/crux.config.ts"},
			IndexedAt:     "2026-05-25T00:00:00.000Z",
			Definitions: []store.ProjectDefinition{
				{ID: "prompt:p1", Kind: "prompt", Name: "p1", Fidelity: "resolved", Status: "active", Fingerprint: "fp-new"},
				{ID: "eval.prompt:p1-eval", Kind: "eval.prompt", Name: "p1 eval", Fidelity: "resolved", Status: "active"},
				{ID: "suite:regression", Kind: "suite", Name: "regression", Fidelity: "resolved", Status: "active"},
			},
			Relations: []store.ProjectRelation{
				{ID: "relation:eval:p1", Type: "eval.targets_prompt", From: "eval.prompt:p1-eval", To: "prompt:p1", Fidelity: "resolved"},
				{ID: "relation:suite:p1", Type: "suite.includes_eval", From: "suite:regression", To: "eval.prompt:p1-eval", Fidelity: "resolved"},
			},
			Diagnostics: []store.IndexDiagnostic{},
			Sources:     []store.IndexSourceFile{{File: "/tmp/project/crux.config.ts", Status: "indexed"}},
		},
	})
	srv := NewHTTPServerWithServices(devSvc, ServerOptions{QualityDir: dir})
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
	if prompt.Quality == nil || prompt.Quality.ChangedSinceBaseline == nil || !*prompt.Quality.ChangedSinceBaseline {
		t.Fatalf("prompt quality = %+v", prompt.Quality)
	}
	if !containsString(prompt.Quality.AffectedEvalIDs, "p1-eval") || !containsString(prompt.Quality.AffectedSuiteIDs, "regression") {
		t.Fatalf("prompt affected = evals %+v suites %+v", prompt.Quality.AffectedEvalIDs, prompt.Quality.AffectedSuiteIDs)
	}
}

func TestHTTPServer_project_index_reindex_endpoint_accepts_incremental_deltas(t *testing.T) {
	root := t.TempDir()
	s := store.NewStore()
	previous := store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "project"},
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:old", Kind: "prompt", Name: "old", Fidelity: "resolved", Status: "active", Source: &store.SourceLoc{File: "src/a.ts", Line: 1}},
			{ID: "prompt:kept", Kind: "prompt", Name: "kept", Fidelity: "resolved", Status: "active", Source: &store.SourceLoc{File: "src/b.ts", Line: 1}},
		},
		Sources: []store.IndexSourceFile{
			{File: "src/a.ts", Status: "active", DefinitionIDs: []string{"prompt:old"}},
			{File: "src/b.ts", Status: "active", DefinitionIDs: []string{"prompt:kept"}},
		},
	}
	indexer := &fakeIncrementalProjectIndexer{
		result: devtools.ProjectIndexIncrementalResult{
			Report: devtools.ProjectIndexIncrementalReport{PlanKind: "source-file-reindex"},
			Patches: []devtools.IndexPatch{
				{
					SchemaVersion: 1,
					Phase:         "ast",
					Project:       store.ProjectIdentity{Root: root, Name: "project"},
					Status:        "ok",
					Invalidates:   &devtools.IndexPatchInvalidation{Files: []string{"src/a.ts"}},
					Facts: devtools.IndexPatchFacts{
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
	devSvc := devtools.NewService(s, quality.NewService(s, quality.Dir(t.TempDir()))).WithProjectIndexer(indexer)
	devSvc.ApplyIndexPatch(context.Background(), devtools.IndexPatch{
		SchemaVersion: 1,
		Phase:         "ast",
		Project:       *previous.Project,
		Status:        "ok",
		Invalidates:   &devtools.IndexPatchInvalidation{All: true},
		Facts: devtools.IndexPatchFacts{
			Definitions: previous.Definitions,
			Sources:     previous.Sources,
		},
	})
	srv := NewHTTPServerWithServices(devSvc, ServerOptions{QualityDir: t.TempDir()})
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

func TestHTTPServer_quality_experiments_endpoint(t *testing.T) {
	dir := t.TempDir()
	writeQualityRecordFixture(t, dir, "experiments", "support-v1", `{"_tag":"Experiment","id":"support-v1","startedAt":"2026-05-14T00:00:00.000Z"}`)

	s := store.NewStore()
	srv := NewHTTPServer(s, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/quality/experiments")
	if err != nil {
		t.Fatalf("GET /api/quality/experiments error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}

	var experiments []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&experiments); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}
	if len(experiments) != 1 {
		t.Fatalf("experiments len = %d, want 1", len(experiments))
	}
	if experiments[0]["id"] != "support-v1" {
		t.Errorf("experiment id = %v, want support-v1", experiments[0]["id"])
	}
}

func TestHTTPServer_quality_comparisons_endpoint(t *testing.T) {
	dir := t.TempDir()
	writeQualityRecordFixture(t, dir, "comparisons", "candidate-vs-baseline", `{"_tag":"QualityComparison","id":"candidate-vs-baseline"}`)

	s := store.NewStore()
	srv := NewHTTPServer(s, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/quality/comparisons")
	if err != nil {
		t.Fatalf("GET /api/quality/comparisons error: %v", err)
	}
	defer resp.Body.Close()

	var comparisons []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&comparisons); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}
	if len(comparisons) != 1 || comparisons[0]["id"] != "candidate-vs-baseline" {
		t.Fatalf("comparisons = %#v, want candidate-vs-baseline", comparisons)
	}
}

func TestHTTPServer_creates_quality_comparison(t *testing.T) {
	dir := t.TempDir()
	writeQualityRecordFixture(t, dir, "experiments", "baseline", qualityExperimentFixture("baseline", "mini", "failed", 100, 0.7))
	writeQualityRecordFixture(t, dir, "experiments", "candidate", qualityExperimentFixture("candidate", "sonnet", "passed", 80, 0.9))

	s := store.NewStore()
	srv := NewHTTPServer(s, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	body := `{"baseline":{"experiment":"baseline","variantId":"mini"},"candidate":{"experiment":"candidate","variantId":"sonnet"},"id":"baseline-vs-candidate"}`
	resp, err := http.Post(ts.URL+"/api/quality/comparisons", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST /api/quality/comparisons error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		data, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d, want 201: %s", resp.StatusCode, string(data))
	}

	var comparison map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&comparison); err != nil {
		t.Fatalf("decode comparison: %v", err)
	}
	if comparison["id"] != "baseline-vs-candidate" || comparison["status"] != "candidate_better" {
		t.Fatalf("comparison = %#v", comparison)
	}
	caseDeltas := comparison["caseDeltas"].([]any)
	if len(caseDeltas) != 1 || caseDeltas[0].(map[string]any)["status"] != "fixed" {
		t.Fatalf("caseDeltas = %#v, want one fixed case", caseDeltas)
	}
	if _, err := os.Stat(filepath.Join(dir, "comparisons", "baseline-vs-candidate.json")); err != nil {
		t.Fatalf("comparison file not written: %v", err)
	}
}

func TestHTTPServer_quality_baselines_endpoint(t *testing.T) {
	dir := t.TempDir()
	writeQualityRecordFixture(t, dir, "baselines", "current-support", `{"_tag":"QualityBaseline","id":"current-support"}`)

	s := store.NewStore()
	srv := NewHTTPServer(s, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/quality/baselines")
	if err != nil {
		t.Fatalf("GET /api/quality/baselines error: %v", err)
	}
	defer resp.Body.Close()

	var baselines []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&baselines); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}
	if len(baselines) != 1 || baselines[0]["id"] != "current-support" {
		t.Fatalf("baselines = %#v, want current-support", baselines)
	}
}

func TestHTTPServer_promotes_quality_baseline(t *testing.T) {
	dir := t.TempDir()
	writeQualityRecordFixture(t, dir, "experiments", "candidate", qualityExperimentFixture("candidate", "sonnet", "passed", 80, 0.9))

	s := store.NewStore()
	srv := NewHTTPServer(s, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	body := `{"id":"production","experiment":"candidate","variantId":"sonnet","label":"Production support"}`
	resp, err := http.Post(ts.URL+"/api/quality/baselines", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST /api/quality/baselines error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		data, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d, want 201: %s", resp.StatusCode, string(data))
	}

	var baseline map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&baseline); err != nil {
		t.Fatalf("decode baseline: %v", err)
	}
	if baseline["id"] != "production" || baseline["experimentId"] != "candidate" {
		t.Fatalf("baseline = %#v", baseline)
	}
	if _, err := os.Stat(filepath.Join(dir, "baselines", "production.json")); err != nil {
		t.Fatalf("baseline file not written: %v", err)
	}
}

func TestHTTPServer_quality_feedback_endpoint(t *testing.T) {
	dir := t.TempDir()
	feedbackDir := filepath.Join(dir, "feedback")
	if err := os.MkdirAll(feedbackDir, 0755); err != nil {
		t.Fatalf("mkdir feedback: %v", err)
	}
	if err := os.WriteFile(filepath.Join(feedbackDir, "inbox.jsonl"), []byte(
		`{"_tag":"QualityFeedback","id":"fb-1","traceId":"tr-1","rating":-1}`+"\n"+
			`{"_tag":"QualityFeedback","id":"fb-2","traceId":"tr-2","rating":1}`+"\n",
	), 0644); err != nil {
		t.Fatalf("write feedback inbox: %v", err)
	}

	s := store.NewStore()
	srv := NewHTTPServer(s, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/quality/feedback")
	if err != nil {
		t.Fatalf("GET /api/quality/feedback error: %v", err)
	}
	defer resp.Body.Close()

	var feedback []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&feedback); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}
	if len(feedback) != 2 || feedback[0]["id"] != "fb-1" || feedback[1]["id"] != "fb-2" {
		t.Fatalf("feedback = %#v, want fb-1 and fb-2", feedback)
	}
}

func TestHTTPServer_records_quality_feedback(t *testing.T) {
	dir := t.TempDir()
	s := store.NewStore()
	srv := NewHTTPServer(s, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	body := `{"traceId":"tr-1","rating":-1,"comment":"Wrong source","tags":["citation"]}`
	resp, err := http.Post(ts.URL+"/api/quality/feedback", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST /api/quality/feedback error: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST status = %d, want 201", resp.StatusCode)
	}

	resp, err = http.Get(ts.URL + "/api/quality/feedback")
	if err != nil {
		t.Fatalf("GET /api/quality/feedback error: %v", err)
	}
	defer resp.Body.Close()

	var feedback []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&feedback); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}
	if len(feedback) != 1 {
		t.Fatalf("feedback len = %d, want 1", len(feedback))
	}
	if feedback[0]["_tag"] != "QualityFeedback" || feedback[0]["traceId"] != "tr-1" || feedback[0]["status"] != "new" {
		t.Fatalf("feedback = %#v", feedback[0])
	}
}

func TestHTTPServer_quality_feedback_annotations_endpoint(t *testing.T) {
	dir := t.TempDir()
	feedbackDir := filepath.Join(dir, "feedback")
	if err := os.MkdirAll(feedbackDir, 0755); err != nil {
		t.Fatalf("mkdir feedback: %v", err)
	}
	if err := os.WriteFile(filepath.Join(feedbackDir, "annotations.jsonl"), []byte(
		`{"_tag":"QualityFeedbackAnnotation","id":"ann-1","feedbackId":"fb-1","status":"reviewed"}`+"\n",
	), 0644); err != nil {
		t.Fatalf("write feedback annotations: %v", err)
	}

	s := store.NewStore()
	srv := NewHTTPServer(s, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/quality/feedback/annotations")
	if err != nil {
		t.Fatalf("GET /api/quality/feedback/annotations error: %v", err)
	}
	defer resp.Body.Close()

	var annotations []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&annotations); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}
	if len(annotations) != 1 || annotations[0]["feedbackId"] != "fb-1" {
		t.Fatalf("annotations = %#v, want fb-1", annotations)
	}
}

func TestHTTPServer_records_quality_feedback_annotation(t *testing.T) {
	dir := t.TempDir()
	feedbackDir := filepath.Join(dir, "feedback")
	if err := os.MkdirAll(feedbackDir, 0755); err != nil {
		t.Fatalf("mkdir feedback: %v", err)
	}
	if err := os.WriteFile(filepath.Join(feedbackDir, "inbox.jsonl"), []byte(
		`{"_tag":"QualityFeedback","id":"fb-1","qualityId":"local","createdAt":"2026-05-14T00:00:00.000Z","status":"new"}`+"\n",
	), 0644); err != nil {
		t.Fatalf("write feedback inbox: %v", err)
	}

	s := store.NewStore()
	srv := NewHTTPServer(s, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	body := `{"feedbackId":"fb-1","status":"reviewed","note":"Added to regressions"}`
	resp, err := http.Post(ts.URL+"/api/quality/feedback/annotations", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST /api/quality/feedback/annotations error: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST status = %d, want 201", resp.StatusCode)
	}

	resp, err = http.Get(ts.URL + "/api/quality/feedback/annotations")
	if err != nil {
		t.Fatalf("GET /api/quality/feedback/annotations error: %v", err)
	}
	defer resp.Body.Close()

	var annotations []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&annotations); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}
	if len(annotations) != 1 || annotations[0]["feedbackId"] != "fb-1" || annotations[0]["status"] != "reviewed" {
		t.Fatalf("annotations = %#v", annotations)
	}
}

func TestHTTPServer_quality_feedback_endpoint_overlays_latest_status(t *testing.T) {
	dir := t.TempDir()
	feedbackDir := filepath.Join(dir, "feedback")
	if err := os.MkdirAll(feedbackDir, 0755); err != nil {
		t.Fatalf("mkdir feedback: %v", err)
	}
	if err := os.WriteFile(filepath.Join(feedbackDir, "inbox.jsonl"), []byte(
		`{"_tag":"QualityFeedback","id":"fb-1","qualityId":"local","createdAt":"2026-05-14T00:00:00.000Z","status":"new","traceId":"tr-1"}`+"\n",
	), 0644); err != nil {
		t.Fatalf("write feedback inbox: %v", err)
	}

	s := store.NewStore()
	srv := NewHTTPServer(s, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	body := `{"feedbackId":"fb-1","status":"dismissed","note":"Not actionable."}`
	resp, err := http.Post(ts.URL+"/api/quality/feedback/annotations", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST /api/quality/feedback/annotations error: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST status = %d, want 201", resp.StatusCode)
	}

	resp, err = http.Get(ts.URL + "/api/quality/feedback")
	if err != nil {
		t.Fatalf("GET /api/quality/feedback error: %v", err)
	}
	defer resp.Body.Close()

	var feedback []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&feedback); err != nil {
		t.Fatalf("decode feedback: %v", err)
	}
	if len(feedback) != 1 || feedback[0]["status"] != "dismissed" {
		t.Fatalf("feedback = %#v, want dismissed overlay", feedback)
	}
}

func TestHTTPServer_quality_feedback_memory_proposals_endpoint(t *testing.T) {
	dir := t.TempDir()
	feedbackDir := filepath.Join(dir, "feedback")
	if err := os.MkdirAll(feedbackDir, 0755); err != nil {
		t.Fatalf("mkdir feedback: %v", err)
	}
	if err := os.WriteFile(filepath.Join(feedbackDir, "memory-proposals.jsonl"), []byte(
		`{"_tag":"QualityFeedbackMemoryProposal","id":"proposal-1","feedbackId":"fb-1","status":"proposed","proposal":{"preference":"short answers"}}`+"\n",
	), 0644); err != nil {
		t.Fatalf("write feedback memory proposals: %v", err)
	}

	s := store.NewStore()
	srv := NewHTTPServer(s, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/quality/feedback/memory-proposals")
	if err != nil {
		t.Fatalf("GET /api/quality/feedback/memory-proposals error: %v", err)
	}
	defer resp.Body.Close()

	var proposals []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&proposals); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}
	if len(proposals) != 1 || proposals[0]["feedbackId"] != "fb-1" || proposals[0]["status"] != "proposed" {
		t.Fatalf("proposals = %#v, want fb-1 proposed", proposals)
	}
}

func TestHTTPServer_quality_cassettes_endpoint(t *testing.T) {
	dir := t.TempDir()
	cassetteDir := filepath.Join(dir, "cassettes")
	if err := os.MkdirAll(cassetteDir, 0755); err != nil {
		t.Fatalf("mkdir cassettes: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cassetteDir, "support.cassette.json"), []byte(
		`{"_tag":"Cassette","version":1,"entries":[{"id":"entry-1","caseId":"case-1","request":{"kind":"generate","targetId":"support","provider":"openai","model":"gpt-4o","inputHash":"abc"},"response":{"output":{"answer":"ok"}},"recordedAt":"2026-05-14T00:00:00.000Z","redactionVersion":"v1"}]}`,
	), 0644); err != nil {
		t.Fatalf("write cassette: %v", err)
	}

	s := store.NewStore()
	srv := NewHTTPServer(s, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/quality/cassettes")
	if err != nil {
		t.Fatalf("GET /api/quality/cassettes error: %v", err)
	}
	defer resp.Body.Close()

	var cassettes []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&cassettes); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}
	if len(cassettes) != 1 || cassettes[0]["path"] != filepath.Join(cassetteDir, "support.cassette.json") {
		t.Fatalf("cassettes = %#v, want support cassette", cassettes)
	}
	if cassettes[0]["entryCount"] != float64(1) {
		t.Fatalf("entryCount = %#v, want 1", cassettes[0]["entryCount"])
	}
	if cassettes[0]["providerCallsAvoided"] != float64(1) {
		t.Fatalf("providerCallsAvoided = %#v, want 1", cassettes[0]["providerCallsAvoided"])
	}
	boundaries, ok := cassettes[0]["boundaries"].(map[string]any)
	if !ok || boundaries["generate"] == nil {
		t.Fatalf("boundaries = %#v, want generate boundary", cassettes[0]["boundaries"])
	}
	items, ok := cassettes[0]["entries"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("entries = %#v, want one entry", cassettes[0]["entries"])
	}
	item := items[0].(map[string]any)
	if item["kind"] != "generate" || item["targetId"] != "support" || item["status"] != "recorded" {
		t.Fatalf("cassette entry = %#v, want generate support recorded", item)
	}
}

func TestHTTPServer_quality_cassettes_endpoint_discovers_project_cassette_files(t *testing.T) {
	dir := t.TempDir()
	projectRoot := t.TempDir()
	cassetteDir := filepath.Join(projectRoot, "evals", "cassettes", "regressions")
	if err := os.MkdirAll(cassetteDir, 0755); err != nil {
		t.Fatalf("mkdir project cassettes: %v", err)
	}
	cassettePath := filepath.Join(cassetteDir, "writer.cassette.json")
	if err := os.WriteFile(cassettePath, []byte(`{"mode":"ci","entries":[{"id":"entry-1","caseId":"writer","request":{"kind":"generate","targetId":"writer","provider":"openai","model":"gpt-4.1"},"response":{},"recordedAt":"2026-06-06T00:00:00Z"}]}`), 0644); err != nil {
		t.Fatalf("write cassette: %v", err)
	}

	s := store.NewStore()
	devSvc := devtools.NewService(s, quality.NewService(s, quality.Dir(dir))).WithProjectIndexer(fakeProjectIndexer{
		index: store.IndexData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: projectRoot},
			IndexedAt:     "2026-06-06T00:00:00.000Z",
		},
	})
	srv := NewHTTPServerWithServices(devSvc, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Post(ts.URL+"/api/project/index/reindex", "application/json", strings.NewReader(fmt.Sprintf(`{"root":%q}`, projectRoot)))
	if err != nil {
		t.Fatalf("POST /api/project/index/reindex error: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /api/project/index/reindex status = %d, want 200", resp.StatusCode)
	}

	resp, err = http.Get(ts.URL + "/api/quality/cassettes")
	if err != nil {
		t.Fatalf("GET /api/quality/cassettes error: %v", err)
	}
	defer resp.Body.Close()

	var cassettes []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&cassettes); err != nil {
		t.Fatalf("decode cassettes: %v", err)
	}
	if len(cassettes) != 1 {
		t.Fatalf("cassettes len = %d, want 1: %#v", len(cassettes), cassettes)
	}
	if cassettes[0]["path"] != cassettePath || cassettes[0]["entryCount"] != float64(1) {
		t.Fatalf("cassette summary = %#v", cassettes[0])
	}
}

func TestHTTPServer_quality_overview_counts_project_cassette_files(t *testing.T) {
	dir := t.TempDir()
	projectRoot := t.TempDir()
	cassetteDir := filepath.Join(projectRoot, "evals", "cassettes")
	if err := os.MkdirAll(cassetteDir, 0755); err != nil {
		t.Fatalf("mkdir project cassettes: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cassetteDir, "writer.cassette.json"), []byte(`{"entries":[]}`), 0644); err != nil {
		t.Fatalf("write cassette: %v", err)
	}

	s := store.NewStore()
	devSvc := devtools.NewService(s, quality.NewService(s, quality.Dir(dir))).WithProjectIndexer(fakeProjectIndexer{
		index: store.IndexData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: projectRoot},
			IndexedAt:     "2026-06-06T00:00:00.000Z",
		},
	})
	srv := NewHTTPServerWithServices(devSvc, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Post(ts.URL+"/api/project/index/reindex", "application/json", strings.NewReader(fmt.Sprintf(`{"root":%q}`, projectRoot)))
	if err != nil {
		t.Fatalf("POST /api/project/index/reindex error: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /api/project/index/reindex status = %d, want 200", resp.StatusCode)
	}

	resp, err = http.Get(ts.URL + "/api/quality/overview")
	if err != nil {
		t.Fatalf("GET /api/quality/overview error: %v", err)
	}
	defer resp.Body.Close()

	var overview map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&overview); err != nil {
		t.Fatalf("decode overview: %v", err)
	}
	if overview["cassetteCount"] != float64(1) {
		t.Fatalf("cassetteCount = %#v, want 1: %#v", overview["cassetteCount"], overview)
	}
}

func TestHTTPServer_quality_suites_endpoint_derives_suite_records_from_experiments(t *testing.T) {
	dir := t.TempDir()
	writeQualityRecordFixture(t, dir, "experiments", "support-v1", `{
		"_tag":"Experiment",
		"id":"support-v1",
		"suite":{
			"id":"support",
			"name":"Support QA",
			"source":"json",
			"path":"quality/support.json",
			"caseCount":2,
			"snapshot":[
				{"id":"refunds","name":"Refunds","input":{"question":"How do refunds work?"},"tags":["billing"],"expected":{"answer":{"contains":["refund"]}}},
				{"id":"sso","input":{"question":"How does SSO work?"},"tags":["auth"]}
			]
		},
		"summary":{"total":2,"passed":1,"failed":1,"errored":0},
		"cases":[{"caseId":"refunds","variantId":"main","status":"passed"},{"caseId":"sso","variantId":"main","status":"failed"}]
	}`)

	s := store.NewStore()
	srv := NewHTTPServer(s, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/quality/suites")
	if err != nil {
		t.Fatalf("GET /api/quality/suites error: %v", err)
	}
	defer resp.Body.Close()

	var suites []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&suites); err != nil {
		t.Fatalf("decode suites: %v", err)
	}
	if len(suites) != 1 {
		t.Fatalf("suites len = %d, want 1", len(suites))
	}
	if suites[0]["suiteId"] != "support" || suites[0]["name"] != "Support QA" || suites[0]["source"] != "json" {
		t.Fatalf("suite summary = %#v", suites[0])
	}
	if suites[0]["lastExperimentId"] != "support-v1" || suites[0]["lastPassRate"] != 0.5 {
		t.Fatalf("suite last run fields = %#v", suites[0])
	}
	cases, ok := suites[0]["cases"].([]any)
	if !ok || len(cases) != 2 {
		t.Fatalf("suite cases = %#v, want two cases", suites[0]["cases"])
	}
}

func TestHTTPServer_quality_suites_endpoint_includes_index_authored_suites(t *testing.T) {
	dir := t.TempDir()
	column := 28
	s := store.NewStore()
	devSvc := devtools.NewService(s, quality.NewService(s, quality.Dir(dir))).WithProjectIndexer(fakeProjectIndexer{
		index: store.IndexData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: "/tmp/project", ConfigFile: "/tmp/project/crux.config.ts"},
			IndexedAt:     "2026-06-06T00:00:00.000Z",
			Definitions: []store.ProjectDefinition{
				{
					ID:       "suite:writer-regressions",
					Kind:     "suite",
					Name:     "writer-regressions",
					Fidelity: "resolved",
					Status:   "active",
					Source:   &store.SourceLoc{File: "/tmp/project/evals/writer.suite.ts", Line: 3, Column: &column},
					Metadata: json.RawMessage(`{"source":"code","caseCount":2}`),
				},
			},
		},
	})
	srv := NewHTTPServerWithServices(devSvc, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Post(ts.URL+"/api/project/index/reindex", "application/json", strings.NewReader(`{"root":"/tmp/project"}`))
	if err != nil {
		t.Fatalf("POST /api/project/index/reindex error: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /api/project/index/reindex status = %d, want 200", resp.StatusCode)
	}

	resp, err = http.Get(ts.URL + "/api/quality/suites")
	if err != nil {
		t.Fatalf("GET /api/quality/suites error: %v", err)
	}
	defer resp.Body.Close()

	var suites []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&suites); err != nil {
		t.Fatalf("decode suites: %v", err)
	}
	if len(suites) != 1 {
		t.Fatalf("suites len = %d, want 1: %#v", len(suites), suites)
	}
	if suites[0]["suiteId"] != "writer-regressions" || suites[0]["source"] != "code" {
		t.Fatalf("suite summary = %#v", suites[0])
	}
	if suites[0]["path"] != "/tmp/project/evals/writer.suite.ts" || suites[0]["caseCount"] != float64(2) {
		t.Fatalf("suite source fields = %#v", suites[0])
	}
}

func TestHTTPServer_quality_suites_endpoint_includes_index_authored_suite_cases(t *testing.T) {
	dir := t.TempDir()
	column := 4
	s := store.NewStore()
	devSvc := devtools.NewService(s, quality.NewService(s, quality.Dir(dir))).WithProjectIndexer(fakeProjectIndexer{
		index: store.IndexData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: "/tmp/project", ConfigFile: "/tmp/project/crux.config.ts"},
			IndexedAt:     "2026-06-06T00:00:00.000Z",
			Definitions: []store.ProjectDefinition{
				{
					ID:       "suite:writer-suite",
					Kind:     "suite",
					Name:     "writer-suite",
					Fidelity: "resolved",
					Status:   "active",
					Source:   &store.SourceLoc{File: "/tmp/project/evals/writer.suite.ts", Line: 3, Column: &column},
					Metadata: json.RawMessage(`{"source":"code","caseCount":1}`),
				},
				{
					ID:       "suite.case:writer-suite:draft-title",
					Kind:     "suite.case",
					Name:     "draft title",
					Fidelity: "resolved",
					Status:   "active",
					Source:   &store.SourceLoc{File: "/tmp/project/evals/writer.suite.ts", Line: 4, Column: &column},
					Metadata: json.RawMessage(`{"suiteId":"writer-suite","input":{"topic":"Launch"},"expected":{"title":"Launch"},"tags":["regression"]}`),
				},
			},
			Relations: []store.ProjectRelation{
				{
					ID:       "suite.includes_case:suite:writer-suite->suite.case:writer-suite:draft-title",
					Type:     "suite.includes_case",
					From:     "suite:writer-suite",
					To:       "suite.case:writer-suite:draft-title",
					Fidelity: "resolved",
				},
			},
		},
	})
	srv := NewHTTPServerWithServices(devSvc, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Post(ts.URL+"/api/project/index/reindex", "application/json", strings.NewReader(`{"root":"/tmp/project"}`))
	if err != nil {
		t.Fatalf("POST /api/project/index/reindex error: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /api/project/index/reindex status = %d, want 200", resp.StatusCode)
	}

	resp, err = http.Get(ts.URL + "/api/quality/suites")
	if err != nil {
		t.Fatalf("GET /api/quality/suites error: %v", err)
	}
	defer resp.Body.Close()

	var suites []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&suites); err != nil {
		t.Fatalf("decode suites: %v", err)
	}
	if len(suites) != 1 {
		t.Fatalf("suites len = %d, want 1: %#v", len(suites), suites)
	}
	cases, ok := suites[0]["cases"].([]any)
	if !ok || len(cases) != 1 {
		t.Fatalf("cases = %#v, want one authored case", suites[0]["cases"])
	}
	testCase, ok := cases[0].(map[string]any)
	if !ok {
		t.Fatalf("case = %#v, want object", cases[0])
	}
	if testCase["caseId"] != "draft-title" || testCase["name"] != "draft title" {
		t.Fatalf("case identity = %#v, want draft-title", testCase)
	}
	if input, ok := testCase["input"].(map[string]any); !ok || input["topic"] != "Launch" {
		t.Fatalf("case input = %#v, want Launch topic", testCase["input"])
	}
	if expected, ok := testCase["expected"].(map[string]any); !ok || expected["title"] != "Launch" {
		t.Fatalf("case expected = %#v, want Launch title", testCase["expected"])
	}
}

func TestHTTPServer_quality_overview_counts_index_authored_suites(t *testing.T) {
	dir := t.TempDir()
	s := store.NewStore()
	devSvc := devtools.NewService(s, quality.NewService(s, quality.Dir(dir))).WithProjectIndexer(fakeProjectIndexer{
		index: store.IndexData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: "/tmp/project"},
			IndexedAt:     "2026-06-06T00:00:00.000Z",
			Definitions: []store.ProjectDefinition{
				{ID: "suite:writer-regressions", Kind: "suite", Name: "writer-regressions", Fidelity: "resolved", Status: "active"},
				{ID: "suite:research-regressions", Kind: "suite", Name: "research-regressions", Fidelity: "resolved", Status: "active"},
			},
		},
	})
	srv := NewHTTPServerWithServices(devSvc, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Post(ts.URL+"/api/project/index/reindex", "application/json", strings.NewReader(`{"root":"/tmp/project"}`))
	if err != nil {
		t.Fatalf("POST /api/project/index/reindex error: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /api/project/index/reindex status = %d, want 200", resp.StatusCode)
	}

	resp, err = http.Get(ts.URL + "/api/quality/overview")
	if err != nil {
		t.Fatalf("GET /api/quality/overview error: %v", err)
	}
	defer resp.Body.Close()

	var overview map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&overview); err != nil {
		t.Fatalf("decode overview: %v", err)
	}
	if overview["suiteCount"] != float64(2) {
		t.Fatalf("suiteCount = %#v, want 2: %#v", overview["suiteCount"], overview)
	}
}

func TestHTTPServer_quality_suites_endpoint_persists_suite_edits(t *testing.T) {
	dir := t.TempDir()
	s := store.NewStore()
	srv := NewHTTPServer(s, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	body := `{"suiteId":"support","name":"Support QA","source":"json","path":"quality/support.json","cases":[{"caseId":"refunds","input":{"question":"How do refunds work?"},"expected":{"answer":{"contains":["refund"]}}}]}`
	resp, err := http.Post(ts.URL+"/api/quality/suites", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST /api/quality/suites error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		data, _ := io.ReadAll(resp.Body)
		t.Fatalf("POST status = %d, want 201: %s", resp.StatusCode, string(data))
	}

	upsert := `{"caseId":"sso","name":"SSO","input":{"question":"How does SSO work?"},"tags":["auth"]}`
	resp, err = http.Post(ts.URL+"/api/quality/suites/support/cases", "application/json", strings.NewReader(upsert))
	if err != nil {
		t.Fatalf("POST /api/quality/suites/support/cases error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		data, _ := io.ReadAll(resp.Body)
		t.Fatalf("case upsert status = %d, want 201: %s", resp.StatusCode, string(data))
	}

	resp, err = http.Get(ts.URL + "/api/quality/suites")
	if err != nil {
		t.Fatalf("GET /api/quality/suites error: %v", err)
	}
	defer resp.Body.Close()

	var suites []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&suites); err != nil {
		t.Fatalf("decode suites: %v", err)
	}
	if len(suites) != 1 || suites[0]["suiteId"] != "support" || suites[0]["caseCount"] != float64(2) {
		t.Fatalf("suites = %#v, want persisted support suite with two cases", suites)
	}
	if _, err := os.Stat(filepath.Join(dir, "suites", "support.json")); err != nil {
		t.Fatalf("suite file not written: %v", err)
	}
}

func TestHTTPServer_quality_runs_endpoint_enriches_traces_for_workbench(t *testing.T) {
	dir := t.TempDir()
	writeQualityRecordFixture(t, dir, "experiments", "support-v1", `{
		"_tag":"Experiment",
		"id":"support-v1",
		"suite":{"id":"support","caseCount":1},
		"summary":{"total":1,"passed":1,"failed":0,"errored":0},
		"cases":[{"caseId":"refunds","variantId":"main","status":"passed","traceId":"tr-1","scores":[{"kind":"numeric","name":"quality","value":0.92}]}]
	}`)
	if err := os.MkdirAll(filepath.Join(dir, "feedback"), 0755); err != nil {
		t.Fatalf("mkdir feedback: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "feedback", "inbox.jsonl"), []byte(
		`{"_tag":"QualityFeedback","id":"fb-1","traceId":"tr-1","rating":1}`+"\n",
	), 0644); err != nil {
		t.Fatalf("write feedback: %v", err)
	}
	cassetteDir := filepath.Join(dir, "cassettes")
	if err := os.MkdirAll(cassetteDir, 0755); err != nil {
		t.Fatalf("mkdir cassettes: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cassetteDir, "support.cassette.json"), []byte(
		`{"_tag":"Cassette","version":1,"entries":[{"id":"entry-1","request":{"kind":"generate","targetId":"support","inputHash":"abc"},"response":{"output":{"answer":"ok"}},"recordedAt":"2026-05-14T00:00:00.000Z"}]}`,
	), 0644); err != nil {
		t.Fatalf("write cassette: %v", err)
	}

	srv := newObservabilityHTTPServer(t, dir,
		`{"schemaVersion":1,"recordId":"run-start-1","type":"run:start","runId":"run-1","traceId":"tr-1","name":"support","rootPrimitive":"generation.call","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":1,"recordId":"span-start-1","type":"span:start","runId":"run-1","traceId":"tr-1","spanId":"span-1","family":"generation","primitive":"generation.call","name":"support","startedAt":"2026-05-16T18:00:00.001Z","status":"running","model":"gpt-4o","provider":"openai","promptId":"support"}`,
		`{"schemaVersion":1,"recordId":"tool-start-1","type":"span:start","runId":"run-1","traceId":"tr-1","spanId":"tool-1","parentSpanId":"span-1","family":"tool","primitive":"tool.call","name":"searchDocs","startedAt":"2026-05-16T18:00:00.010Z","status":"running","toolName":"searchDocs"}`,
		`{"schemaVersion":1,"recordId":"tool-end-1","type":"span:end","runId":"run-1","traceId":"tr-1","spanId":"tool-1","endedAt":"2026-05-16T18:00:00.020Z","durationMs":10,"status":"ok"}`,
		`{"schemaVersion":1,"recordId":"span-end-1","type":"span:end","runId":"run-1","traceId":"tr-1","spanId":"span-1","endedAt":"2026-05-16T18:00:00.042Z","durationMs":41,"status":"ok","metrics":{"inputTokens":10,"outputTokens":12,"totalTokens":22,"costUsd":0.02}}`,
		`{"schemaVersion":1,"recordId":"run-end-1","type":"run:end","runId":"run-1","traceId":"tr-1","endedAt":"2026-05-16T18:00:00.043Z","durationMs":43,"status":"ok","metrics":{"inputTokens":10,"outputTokens":12,"totalTokens":22,"costUsd":0.02}}`,
	)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/quality/runs")
	if err != nil {
		t.Fatalf("GET /api/quality/runs error: %v", err)
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
	if run["traceId"] != "run-1" || run["targetId"] != "support" || run["toolCallCount"] != float64(1) {
		t.Fatalf("run = %#v", run)
	}
	feedbackIDs := run["feedbackIds"].([]any)
	experimentIDs := run["experimentIds"].([]any)
	if len(feedbackIDs) != 1 || feedbackIDs[0] != "fb-1" || len(experimentIDs) != 1 || experimentIDs[0] != "support-v1" {
		t.Fatalf("run links = feedback %#v experiments %#v", feedbackIDs, experimentIDs)
	}
	if run["cassetteStatus"] != "linked" {
		t.Fatalf("cassetteStatus = %#v, want linked", run["cassetteStatus"])
	}
	if run["tokenCount"] != float64(22) || run["score"] != 0.92 {
		t.Fatalf("run token/score fields = %#v", run)
	}
}

func TestHTTPServer_quality_delete_runs_removes_observability(t *testing.T) {
	dir := t.TempDir()
	srv := newObservabilityHTTPServer(t, dir,
		`{"schemaVersion":1,"recordId":"run-start-1","type":"run:start","runId":"run-1","traceId":"trace-1","name":"support","rootPrimitive":"generation.call","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":1,"recordId":"span-start-1","type":"span:start","runId":"run-1","traceId":"trace-1","spanId":"span-1","family":"generation","primitive":"generation.call","name":"support","startedAt":"2026-05-16T18:00:00.001Z","status":"running"}`,
		`{"schemaVersion":1,"recordId":"span-event-1","type":"span:event","runId":"run-1","traceId":"trace-1","spanId":"span-1","eventId":"event-1","name":"token.delta","timestamp":"2026-05-16T18:00:00.002Z","attributes":{"text":"ok"}}`,
		`{"schemaVersion":1,"recordId":"artifact-1","type":"artifact","runId":"run-1","traceId":"trace-1","artifactId":"artifact-1","spanId":"span-1","kind":"output","createdAt":"2026-05-16T18:00:00.003Z","contentType":"application/json","encoding":"json","preview":{"text":"ok"}}`,
		`{"schemaVersion":1,"recordId":"edge-1","type":"edge","runId":"run-1","traceId":"trace-1","edgeId":"edge-1","edgeType":"produced","from":{"kind":"span","id":"span-1"},"to":{"kind":"artifact","id":"artifact-1"},"createdAt":"2026-05-16T18:00:00.004Z"}`,
		`{"schemaVersion":1,"recordId":"run-end-1","type":"run:end","runId":"run-1","traceId":"trace-1","endedAt":"2026-05-16T18:00:00.010Z","durationMs":10,"status":"ok"}`,
		`{"schemaVersion":1,"recordId":"run-start-2","type":"run:start","runId":"run-2","traceId":"trace-2","name":"writer","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:01:00.000Z","status":"running"}`,
		`{"schemaVersion":1,"recordId":"run-end-2","type":"run:end","runId":"run-2","traceId":"trace-2","endedAt":"2026-05-16T18:01:00.010Z","durationMs":10,"status":"ok"}`,
	)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	req, err := http.NewRequest(http.MethodDelete, ts.URL+"/api/quality/runs/trace-1", nil)
	if err != nil {
		t.Fatalf("create delete request: %v", err)
	}
	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatalf("DELETE /api/quality/runs/trace-1 error: %v", err)
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
	if got := single["deletedTraceIds"].([]any); len(got) != 1 || got[0] != "run-1" {
		t.Fatalf("single deletedTraceIds = %#v", got)
	}

	resp, err = http.Get(ts.URL + "/api/quality/runs/run-1")
	if err != nil {
		t.Fatalf("GET deleted run detail error: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("deleted run detail status = %d, want 404", resp.StatusCode)
	}

	bulkBody := strings.NewReader(`{"traceIds":["run-2","missing-run"]}`)
	req, err = http.NewRequest(http.MethodDelete, ts.URL+"/api/quality/runs", bulkBody)
	if err != nil {
		t.Fatalf("create bulk delete request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err = ts.Client().Do(req)
	if err != nil {
		t.Fatalf("DELETE /api/quality/runs error: %v", err)
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
	if got := bulk["deletedTraceIds"].([]any); len(got) != 1 || got[0] != "run-2" {
		t.Fatalf("bulk deletedTraceIds = %#v", got)
	}
	if got := bulk["missingTraceIds"].([]any); len(got) != 1 || got[0] != "missing-run" {
		t.Fatalf("bulk missingTraceIds = %#v", got)
	}
}

func TestHTTPServer_quality_insights_endpoint_derives_attention_items(t *testing.T) {
	dir := t.TempDir()
	writeQualityRecordFixture(t, dir, "experiments", "support-v1", `{
		"_tag":"Experiment",
		"id":"support-v1",
		"suite":{"id":"support","caseCount":2},
		"summary":{"total":2,"passed":1,"failed":1,"errored":0},
		"cases":[{"caseId":"okta","variantId":"main","status":"failed"}]
	}`)
	if err := os.MkdirAll(filepath.Join(dir, "feedback"), 0755); err != nil {
		t.Fatalf("mkdir feedback: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "feedback", "inbox.jsonl"), []byte(
		`{"_tag":"QualityFeedback","id":"fb-1","traceId":"tr-1","status":"new","rating":-1}`+"\n",
	), 0644); err != nil {
		t.Fatalf("write feedback: %v", err)
	}
	srv := newObservabilityHTTPServer(t, dir,
		`{"schemaVersion":1,"recordId":"run-start-loop","type":"run:start","runId":"run-loop","traceId":"tr-loop","name":"agent","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":1,"recordId":"span-start-loop","type":"span:start","runId":"run-loop","traceId":"tr-loop","spanId":"span-loop","family":"agent","primitive":"agent.run","name":"agent","startedAt":"2026-05-16T18:00:00.001Z","status":"running","model":"gpt-4o","provider":"openai","promptId":"agent"}`,
		`{"schemaVersion":1,"recordId":"tool-start-1","type":"span:start","runId":"run-loop","traceId":"tr-loop","spanId":"tool-1","parentSpanId":"span-loop","family":"tool","primitive":"tool.call","name":"search","startedAt":"2026-05-16T18:00:00.010Z","status":"ok","toolName":"search"}`,
		`{"schemaVersion":1,"recordId":"tool-start-2","type":"span:start","runId":"run-loop","traceId":"tr-loop","spanId":"tool-2","parentSpanId":"span-loop","family":"tool","primitive":"tool.call","name":"search","startedAt":"2026-05-16T18:00:00.020Z","status":"ok","toolName":"search"}`,
		`{"schemaVersion":1,"recordId":"tool-start-3","type":"span:start","runId":"run-loop","traceId":"tr-loop","spanId":"tool-3","parentSpanId":"span-loop","family":"tool","primitive":"tool.call","name":"search","startedAt":"2026-05-16T18:00:00.030Z","status":"ok","toolName":"search"}`,
		`{"schemaVersion":1,"recordId":"tool-start-4","type":"span:start","runId":"run-loop","traceId":"tr-loop","spanId":"tool-4","parentSpanId":"span-loop","family":"tool","primitive":"tool.call","name":"search","startedAt":"2026-05-16T18:00:00.040Z","status":"ok","toolName":"search"}`,
		`{"schemaVersion":1,"recordId":"tool-start-5","type":"span:start","runId":"run-loop","traceId":"tr-loop","spanId":"tool-5","parentSpanId":"span-loop","family":"tool","primitive":"tool.call","name":"search","startedAt":"2026-05-16T18:00:00.050Z","status":"ok","toolName":"search"}`,
		`{"schemaVersion":1,"recordId":"tool-start-6","type":"span:start","runId":"run-loop","traceId":"tr-loop","spanId":"tool-6","parentSpanId":"span-loop","family":"tool","primitive":"tool.call","name":"search","startedAt":"2026-05-16T18:00:00.060Z","status":"ok","toolName":"search"}`,
		`{"schemaVersion":1,"recordId":"tool-start-7","type":"span:start","runId":"run-loop","traceId":"tr-loop","spanId":"tool-7","parentSpanId":"span-loop","family":"tool","primitive":"tool.call","name":"search","startedAt":"2026-05-16T18:00:00.070Z","status":"ok","toolName":"search"}`,
		`{"schemaVersion":1,"recordId":"tool-start-8","type":"span:start","runId":"run-loop","traceId":"tr-loop","spanId":"tool-8","parentSpanId":"span-loop","family":"tool","primitive":"tool.call","name":"search","startedAt":"2026-05-16T18:00:00.080Z","status":"ok","toolName":"search"}`,
		`{"schemaVersion":1,"recordId":"span-end-loop","type":"span:end","runId":"run-loop","traceId":"tr-loop","spanId":"span-loop","endedAt":"2026-05-16T18:00:00.500Z","durationMs":500,"status":"ok"}`,
		`{"schemaVersion":1,"recordId":"run-end-loop","type":"run:end","runId":"run-loop","traceId":"tr-loop","endedAt":"2026-05-16T18:00:00.500Z","durationMs":500,"status":"ok"}`,
	)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/quality/insights")
	if err != nil {
		t.Fatalf("GET /api/quality/insights error: %v", err)
	}
	defer resp.Body.Close()

	var insights []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&insights); err != nil {
		t.Fatalf("decode insights: %v", err)
	}
	if len(insights) < 3 {
		t.Fatalf("insights len = %d, want failed experiment, feedback, and loop insights: %#v", len(insights), insights)
	}
	titles := map[string]bool{}
	for _, insight := range insights {
		titles[insight["title"].(string)] = true
	}
	if !titles["Experiment has failed quality cases"] || !titles["Feedback needs review"] || !titles["Potential tool loop detected"] {
		t.Fatalf("insight titles = %#v", titles)
	}
}

func TestHTTPServer_quality_insight_status_persists(t *testing.T) {
	dir := t.TempDir()
	writeQualityRecordFixture(t, dir, "experiments", "support-v1", `{
		"_tag":"Experiment",
		"id":"support-v1",
		"suite":{"id":"support","caseCount":1},
		"summary":{"total":1,"passed":0,"failed":1,"errored":0},
		"cases":[{"caseId":"okta","variantId":"main","status":"failed"}]
	}`)
	s := store.NewStore()
	srv := NewHTTPServer(s, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	body := `{"status":"resolved","note":"Fixed by tightening citations."}`
	resp, err := http.Post(ts.URL+"/api/quality/insights/experiment-support-v1/status", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST /api/quality/insights/{id}/status error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		data, _ := io.ReadAll(resp.Body)
		t.Fatalf("POST status = %d, want 201: %s", resp.StatusCode, string(data))
	}

	resp, err = http.Get(ts.URL + "/api/quality/insights")
	if err != nil {
		t.Fatalf("GET /api/quality/insights error: %v", err)
	}
	defer resp.Body.Close()

	var insights []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&insights); err != nil {
		t.Fatalf("decode insights: %v", err)
	}
	if len(insights) != 1 || insights[0]["status"] != "resolved" {
		t.Fatalf("insights = %#v, want resolved status", insights)
	}
	if insights[0]["resolvedOccurrences"] != float64(2) || insights[0]["resolvedAt"] == "" {
		t.Fatalf("resolved metadata = %#v, want occurrence snapshot", insights[0])
	}

	body = `{"status":"open"}`
	resp, err = http.Post(ts.URL+"/api/quality/insights/experiment-support-v1/status", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST open status error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		data, _ := io.ReadAll(resp.Body)
		t.Fatalf("POST open status = %d, want 201: %s", resp.StatusCode, string(data))
	}
	resp, err = http.Get(ts.URL + "/api/quality/insights")
	if err != nil {
		t.Fatalf("GET reopened insight error: %v", err)
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(&insights); err != nil {
		t.Fatalf("decode reopened insights: %v", err)
	}
	if len(insights) != 1 || insights[0]["status"] != "open" {
		t.Fatalf("insights = %#v, want open status", insights)
	}
}

func TestHTTPServer_quality_insight_silences_create_list_delete(t *testing.T) {
	dir := t.TempDir()
	srv := newObservabilityHTTPServer(t, dir,
		`{"schemaVersion":1,"recordId":"run-start-1","type":"run:start","runId":"run-1","traceId":"run-1","name":"karyla-agent","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running","metrics":{"totalTokens":12000}}`,
		`{"schemaVersion":1,"recordId":"run-end-1","type":"run:end","runId":"run-1","traceId":"run-1","endedAt":"2026-05-16T18:00:00.010Z","durationMs":10,"status":"ok","metrics":{"totalTokens":12000}}`,
	)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	body := `{"insightId":"high-token-usage-run-1","note":"Expected in this fixture."}`
	resp, err := http.Post(ts.URL+"/api/quality/insights/silences", "application/json", strings.NewReader(body))
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
	if pattern["title"] != "Run has high token usage" || pattern["targetId"] != "karyla-agent" {
		t.Fatalf("silence = %#v, want pattern from insight", silence)
	}

	resp, err = http.Get(ts.URL + "/api/quality/insights")
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

	resp, err = http.Get(ts.URL + "/api/quality/insights/silences")
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

	req, err := http.NewRequest(http.MethodDelete, ts.URL+"/api/quality/insights/silences/"+silenceID, nil)
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

	resp, err = http.Get(ts.URL + "/api/quality/insights")
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

func TestHTTPServer_quality_cassette_issues_persist_and_update_counts(t *testing.T) {
	dir := t.TempDir()
	cassetteDir := filepath.Join(dir, "cassettes")
	if err := os.MkdirAll(cassetteDir, 0755); err != nil {
		t.Fatalf("mkdir cassettes: %v", err)
	}
	cassettePath := filepath.Join(cassetteDir, "support.cassette.json")
	if err := os.WriteFile(cassettePath, []byte(
		`{"_tag":"Cassette","version":1,"entries":[{"id":"entry-1","request":{"kind":"generate","targetId":"support"},"response":{"output":{"answer":"ok"}},"recordedAt":"2026-05-14T00:00:00.000Z"}]}`,
	), 0644); err != nil {
		t.Fatalf("write cassette: %v", err)
	}
	s := store.NewStore()
	srv := NewHTTPServer(s, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	body := fmt.Sprintf(`{"path":%q,"entryId":"missing-sso","status":"missing","kind":"generate","targetId":"support","caseId":"sso","reason":"No cassette entry matched request hash."}`, cassettePath)
	resp, err := http.Post(ts.URL+"/api/quality/cassettes/issues", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST /api/quality/cassettes/issues error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		data, _ := io.ReadAll(resp.Body)
		t.Fatalf("POST status = %d, want 201: %s", resp.StatusCode, string(data))
	}

	resp, err = http.Get(ts.URL + "/api/quality/cassettes")
	if err != nil {
		t.Fatalf("GET /api/quality/cassettes error: %v", err)
	}
	defer resp.Body.Close()

	var cassettes []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&cassettes); err != nil {
		t.Fatalf("decode cassettes: %v", err)
	}
	if len(cassettes) != 1 || cassettes[0]["missingCount"] != float64(1) {
		t.Fatalf("cassettes = %#v, want one missing issue", cassettes)
	}
	entries := cassettes[0]["entries"].([]any)
	if len(entries) != 2 {
		t.Fatalf("entries = %#v, want recorded entry plus missing issue", entries)
	}
}

func TestHTTPServer_quality_overview_endpoint_returns_workbench_counts(t *testing.T) {
	dir := t.TempDir()
	writeQualityRecordFixture(t, dir, "experiments", "support-v1", qualityExperimentFixture("support-v1", "main", "passed", 50, 0.9))
	writeQualityRecordFixture(t, dir, "baselines", "current", `{"_tag":"QualityBaseline","id":"current"}`)
	if err := os.MkdirAll(filepath.Join(dir, "feedback"), 0755); err != nil {
		t.Fatalf("mkdir feedback: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "feedback", "inbox.jsonl"), []byte(
		`{"_tag":"QualityFeedback","id":"fb-1","status":"new"}`+"\n",
	), 0644); err != nil {
		t.Fatalf("write feedback: %v", err)
	}
	srv := newObservabilityHTTPServer(t, dir,
		`{"schemaVersion":1,"recordId":"run-start-1","type":"run:start","runId":"run-1","traceId":"tr-1","name":"support","rootPrimitive":"generation.call","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":1,"recordId":"span-start-1","type":"span:start","runId":"run-1","traceId":"tr-1","spanId":"span-1","family":"generation","primitive":"generation.call","name":"support","startedAt":"2026-05-16T18:00:00.001Z","status":"running","model":"gpt-4o","provider":"openai","promptId":"support"}`,
		`{"schemaVersion":1,"recordId":"span-end-1","type":"span:end","runId":"run-1","traceId":"tr-1","spanId":"span-1","endedAt":"2026-05-16T18:00:00.042Z","durationMs":41,"status":"ok"}`,
		`{"schemaVersion":1,"recordId":"run-end-1","type":"run:end","runId":"run-1","traceId":"tr-1","endedAt":"2026-05-16T18:00:00.043Z","durationMs":43,"status":"ok"}`,
	)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/quality/overview")
	if err != nil {
		t.Fatalf("GET /api/quality/overview error: %v", err)
	}
	defer resp.Body.Close()

	var overview map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&overview); err != nil {
		t.Fatalf("decode overview: %v", err)
	}
	if overview["runCount"] != float64(1) || overview["suiteCount"] != float64(1) || overview["experimentCount"] != float64(1) {
		t.Fatalf("overview counts = %#v", overview)
	}
	if overview["feedbackNeedingReviewCount"] != float64(1) || overview["baselineCount"] != float64(1) {
		t.Fatalf("overview feedback/baselines = %#v", overview)
	}
}

func TestHTTPServer_quality_overview_endpoint_returns_design_kpis(t *testing.T) {
	dir := t.TempDir()
	writeQualityRecordFixture(t, dir, "experiments", "support-v1", `{
		"_tag":"Experiment",
		"id":"support-v1",
		"suite":{"id":"support","caseCount":2},
		"summary":{"total":2,"passed":1,"failed":1,"errored":0},
		"cases":[
			{"caseId":"refunds","variantId":"main","status":"passed","traceId":"tr-1","scores":[{"kind":"numeric","name":"quality","value":0.8}]},
			{"caseId":"sso","variantId":"main","status":"failed","traceId":"tr-2","scores":[{"kind":"numeric","name":"quality","value":0.4}]}
		]
	}`)

	srv := newObservabilityHTTPServer(t, dir,
		`{"schemaVersion":1,"recordId":"run-start-1","type":"run:start","runId":"run-1","traceId":"tr-1","name":"support","rootPrimitive":"generation.call","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":1,"recordId":"span-start-1","type":"span:start","runId":"run-1","traceId":"tr-1","spanId":"span-1","family":"generation","primitive":"generation.call","name":"support","startedAt":"2026-05-16T18:00:00.001Z","status":"running","model":"gpt-4o","provider":"openai","promptId":"support"}`,
		`{"schemaVersion":1,"recordId":"span-end-1","type":"span:end","runId":"run-1","traceId":"tr-1","spanId":"span-1","endedAt":"2026-05-16T18:00:00.100Z","durationMs":100,"status":"ok","metrics":{"totalTokens":10,"costUsd":0.2}}`,
		`{"schemaVersion":1,"recordId":"run-end-1","type":"run:end","runId":"run-1","traceId":"tr-1","endedAt":"2026-05-16T18:00:00.100Z","durationMs":100,"status":"ok","metrics":{"totalTokens":10,"costUsd":0.2}}`,
		`{"schemaVersion":1,"recordId":"run-start-2","type":"run:start","runId":"run-2","traceId":"tr-2","name":"support","rootPrimitive":"generation.call","startedAt":"2026-05-16T18:00:01.000Z","status":"running"}`,
		`{"schemaVersion":1,"recordId":"span-start-2","type":"span:start","runId":"run-2","traceId":"tr-2","spanId":"span-2","family":"generation","primitive":"generation.call","name":"support","startedAt":"2026-05-16T18:00:01.001Z","status":"running","model":"gpt-4o","provider":"openai","promptId":"support"}`,
		`{"schemaVersion":1,"recordId":"span-end-2","type":"span:end","runId":"run-2","traceId":"tr-2","spanId":"span-2","endedAt":"2026-05-16T18:00:01.300Z","durationMs":300,"status":"error","metrics":{"totalTokens":20,"costUsd":0.3}}`,
		`{"schemaVersion":1,"recordId":"run-end-2","type":"run:end","runId":"run-2","traceId":"tr-2","endedAt":"2026-05-16T18:00:01.300Z","durationMs":300,"status":"error","metrics":{"totalTokens":20,"costUsd":0.3}}`,
	)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/quality/overview")
	if err != nil {
		t.Fatalf("GET /api/quality/overview error: %v", err)
	}
	defer resp.Body.Close()

	var overview map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&overview); err != nil {
		t.Fatalf("decode overview: %v", err)
	}
	meanScore := overview["meanScore"].(float64)
	if overview["passRate"] != 0.5 || meanScore < 0.599 || meanScore > 0.601 || overview["totalCost"] != 0.5 || overview["p50LatencyMs"] != 100.0 {
		t.Fatalf("overview KPIs = %#v", overview)
	}
	recentRuns := overview["recentRuns"].([]any)
	if len(recentRuns) != 2 {
		t.Fatalf("recentRuns len = %d, want 2", len(recentRuns))
	}
}

func TestHTTPServer_quality_scorers_endpoint_derives_scorer_rows(t *testing.T) {
	dir := t.TempDir()
	writeQualityRecordFixture(t, dir, "experiments", "support-v1", qualityExperimentFixture("support-v1", "main", "passed", 50, 0.9))

	s := store.NewStore()
	srv := NewHTTPServer(s, ServerOptions{QualityDir: dir})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/quality/scorers")
	if err != nil {
		t.Fatalf("GET /api/quality/scorers error: %v", err)
	}
	defer resp.Body.Close()

	var scorers []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&scorers); err != nil {
		t.Fatalf("decode scorers: %v", err)
	}
	if len(scorers) != 1 || scorers[0]["name"] != "quality" || scorers[0]["meanScore"] != 0.9 {
		t.Fatalf("scorers = %#v", scorers)
	}
}

func writeQualityRecordFixture(t *testing.T, dir string, kind string, id string, body string) {
	t.Helper()
	recordsDir := filepath.Join(dir, kind)
	if err := os.MkdirAll(recordsDir, 0755); err != nil {
		t.Fatalf("mkdir %s: %v", kind, err)
	}
	if err := os.WriteFile(filepath.Join(recordsDir, id+".json"), []byte(body), 0644); err != nil {
		t.Fatalf("write %s fixture: %v", kind, err)
	}
	if err := os.WriteFile(filepath.Join(recordsDir, "ignore.txt"), []byte(`not json`), 0644); err != nil {
		t.Fatalf("write non-json fixture: %v", err)
	}
}

func newObservabilityHTTPServer(t *testing.T, qualityDir string, records ...string) http.Handler {
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
	return NewHTTPServer(store.NewStore(), ServerOptions{QualityDir: qualityDir, ObservabilityService: obs})
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

func qualityExperimentFixture(id string, variant string, status string, durationMs int, score float64) string {
	return fmt.Sprintf(`{
		"_tag":"Experiment",
		"id":%q,
		"qualityId":"local",
		"suite":{"id":"support","caseCount":1},
		"summary":{"total":1,"passed":1,"failed":0,"errored":0},
		"variants":[{"id":%q,"targetId":"support"}],
		"cases":[{
			"caseId":"case-1",
			"caseName":"Case 1",
			"variantId":%q,
			"status":%q,
			"durationMs":%d,
			"scores":[{"kind":"numeric","name":"quality","value":%f}]
		}]
	}`, id, variant, variant, status, durationMs, score)
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
