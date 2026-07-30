package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/privacy"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/eventwire"
	"github.com/use-crux/crux/packages/local/internal/startup"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestNewDevServerDoesNotWaitForInitialRuntimeArtifacts(t *testing.T) {
	root := t.TempDir()
	t.Chdir(root)
	artifactsStarted := make(chan struct{})
	releaseArtifacts := make(chan struct{})
	opts := devServerTestOptions(t, findFreePort())
	opts.ProjectIndexer = fakeProjectIndexer{}
	opts.RuntimeArtifacts = func(context.Context, string, []store.ProjectDefinition) error {
		close(artifactsStarted)
		<-releaseArtifacts
		return nil
	}

	serverReady := make(chan *DevServer, 1)
	go func() { serverReady <- NewDevServer(opts) }()

	select {
	case srv := <-serverReady:
		close(releaseArtifacts)
		t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })
	case <-time.After(time.Second):
		close(releaseArtifacts)
		srv := <-serverReady
		_ = srv.Shutdown(context.Background())
		t.Fatal("NewDevServer waited for initial runtime artifacts")
	}
	select {
	case <-artifactsStarted:
		t.Fatal("initial runtime artifacts started during construction")
	default:
	}
}

func TestDevServerAppliesEditsCapturedDuringInitialProjectIndex(t *testing.T) {
	root := t.TempDir()
	t.Chdir(root)
	source := filepath.Join(root, "prompt.ts")
	if err := os.WriteFile(source, []byte("export const prompt = 1\n"), 0o644); err != nil {
		t.Fatalf("write initial source: %v", err)
	}
	indexer := &blockingLifecycleProjectIndexer{
		baselineStarted: make(chan struct{}),
		releaseBaseline: make(chan struct{}),
		incremental:     make(chan []string, 1),
	}
	opts := devServerTestOptions(t, findFreePort())
	opts.ProjectIndexer = indexer
	srv := NewDevServer(opts)
	if err := srv.Start(); err != nil {
		t.Fatalf("start server: %v", err)
	}
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })

	select {
	case <-indexer.baselineStarted:
	case <-time.After(time.Second):
		t.Fatal("initial Project Index did not start")
	}
	if err := os.WriteFile(source, []byte("export const prompt = 2\n"), 0o644); err != nil {
		t.Fatalf("edit source during initial Project Index: %v", err)
	}
	close(indexer.releaseBaseline)

	select {
	case files := <-indexer.incremental:
		if len(files) != 1 || files[0] != source {
			t.Fatalf("incremental files = %#v, want [%q]", files, source)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("edit captured during initial Project Index was not applied")
	}
}

func TestDevServerRetriesFullIndexAfterInitialFailureAndBufferedEdit(t *testing.T) {
	root := t.TempDir()
	t.Chdir(root)
	source := filepath.Join(root, "prompt.ts")
	if err := os.WriteFile(source, []byte("export const prompt = 1\n"), 0o644); err != nil {
		t.Fatalf("write initial source: %v", err)
	}
	indexer := &failingBaselineProjectIndexer{
		baselineStarted: make(chan struct{}),
		releaseBaseline: make(chan struct{}),
		fullRetry:       make(chan struct{}),
	}
	opts := devServerTestOptions(t, findFreePort())
	opts.ProjectIndexer = indexer
	srv := NewDevServer(opts)
	if err := srv.Start(); err != nil {
		t.Fatalf("start server: %v", err)
	}
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })

	select {
	case <-indexer.baselineStarted:
	case <-time.After(time.Second):
		t.Fatal("initial Project Index did not start")
	}
	if err := os.WriteFile(source, []byte("export const prompt = 2\n"), 0o644); err != nil {
		t.Fatalf("edit source during initial Project Index: %v", err)
	}
	close(indexer.releaseBaseline)

	select {
	case <-indexer.fullRetry:
	case <-time.After(2 * time.Second):
		t.Fatal("buffered edit did not trigger a full retry after initial Project Index failure")
	}
	indexer.mu.Lock()
	incrementalCalled := indexer.incrementalCalled
	indexer.mu.Unlock()
	if incrementalCalled {
		t.Fatal("incremental Project Index ran without a successful baseline")
	}
}

func TestDevServerRetriesFailedRuntimeArtifactsWithFreshIndexAfterNextEdit(t *testing.T) {
	root := t.TempDir()
	t.Chdir(root)
	source := filepath.Join(root, "prompt.ts")
	if err := os.WriteFile(source, []byte("export const prompt = 1\n"), 0o644); err != nil {
		t.Fatalf("write initial source: %v", err)
	}
	indexer := &fakeIncrementalProjectIndexer{
		fullIndex: store.IndexData{
			Definitions: []store.ProjectDefinition{{ID: "prompt:baseline", Kind: "prompt", Name: "baseline"}},
			Sources:     []store.IndexSourceFile{{File: source, Status: "indexed", ShardID: "."}},
			SourceGraph: &store.ProjectIndexSourceGraph{
				SchemaVersion: 1,
				Capabilities:  []string{"project-shards"},
				Shards:        []store.ProjectIndexShard{{ID: ".", Root: root}},
			},
		},
		result: projectindex.ProjectIndexIncrementalResult{Patches: []projectindex.IndexPatch{{
			SchemaVersion: 1,
			Phase:         projectindex.PhaseAST,
			Project:       store.ProjectIdentity{Root: root, Name: "project"},
			Status:        "ok",
			Invalidates:   &projectindex.IndexPatchInvalidation{All: true},
			Facts: projectindex.IndexPatchFacts{
				Definitions: []store.ProjectDefinition{{ID: "prompt:fresh", Kind: "prompt", Name: "fresh"}},
				Sources:     []store.IndexSourceFile{{File: source, Status: "indexed", ShardID: "."}},
			},
		}}},
	}
	journal := startup.NewJournal([]startup.TaskSpec{
		{ID: "project-index", Phase: "Indexing project"},
		{ID: "runtime-artifacts", Phase: "Generating runtime artifacts"},
	})
	calls := make(chan string, 2)
	callCount := 0
	opts := devServerTestOptions(t, findFreePort())
	opts.ProjectIndexer = indexer
	opts.StartupJournal = journal
	opts.RuntimeArtifacts = func(_ context.Context, _ string, definitions []store.ProjectDefinition) error {
		callCount++
		definitionID := ""
		if len(definitions) > 0 {
			definitionID = definitions[0].ID
			var metadata struct {
				RuntimeRich bool `json:"runtimeRich"`
			}
			if err := json.Unmarshal(definitions[0].Metadata, &metadata); err == nil && metadata.RuntimeRich {
				definitionID += ":runtime-rich"
			}
		}
		calls <- definitionID
		if callCount == 1 {
			return &eventwire.WorkerEventError{
				Code: "RUNTIME_ARTIFACT_GENERATION_FAILED",
				Findings: []eventwire.RuntimeArtifactFinding{{
					Code: "RUNTIME_EVAL_INVALID", Category: "authored", Summary: "Eval source needs attention.", Reason: "The task is not callable.",
				}},
			}
		}
		return nil
	}

	srv := NewDevServer(opts)
	if err := srv.Start(); err != nil {
		t.Fatalf("start server: %v", err)
	}
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })

	select {
	case got := <-calls:
		if got != "prompt:baseline:runtime-rich" {
			t.Fatalf("initial generation definition = %q, want runtime-rich baseline", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("initial runtime artifact generation did not run")
	}

	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	snapshot, updates := journal.SnapshotAndSubscribe(ctx)
	snapshot = awaitStartupTask(t, ctx, snapshot, updates, "runtime-artifacts", startup.Degraded)
	if len(snapshot.Diagnostics) != 1 || len(snapshot.Diagnostics[0].Children) != 1 {
		t.Fatalf("retained generation diagnostics = %#v, want aggregate and child", snapshot.Diagnostics)
	}

	if err := os.WriteFile(source, []byte("export const prompt = 2\n"), 0o644); err != nil {
		t.Fatalf("write recovery edit: %v", err)
	}
	select {
	case got := <-calls:
		if got != "prompt:fresh:runtime-rich" {
			t.Fatalf("retry generation definition = %q, want fresh runtime-rich incremental snapshot (incremental=%v runtime=%d files=%v)", got, indexer.calledIncrement, indexer.calledRuntime, indexer.files)
		}
	case <-ctx.Done():
		t.Fatal("runtime artifact generation did not retry after the next edit")
	}

	snapshot = awaitStartupTask(t, ctx, snapshot, updates, "runtime-artifacts", startup.Succeeded)
	if len(snapshot.Diagnostics) != 0 {
		t.Fatalf("recovered generation diagnostics = %#v, want cleared", snapshot.Diagnostics)
	}
}

func awaitStartupTask(
	t *testing.T,
	ctx context.Context,
	snapshot startup.Snapshot,
	updates <-chan startup.Snapshot,
	taskID string,
	want startup.Disposition,
) startup.Snapshot {
	t.Helper()
	for {
		for _, task := range snapshot.Tasks {
			if task.ID == taskID && task.Disposition == want {
				return snapshot
			}
		}
		select {
		case next := <-updates:
			snapshot = next
		case <-ctx.Done():
			t.Fatalf("startup task %q did not reach %q", taskID, want)
		}
	}
}

type blockingLifecycleProjectIndexer struct {
	baselineStarted chan struct{}
	releaseBaseline chan struct{}
	incremental     chan []string
	baselineOnce    sync.Once
}

type failingBaselineProjectIndexer struct {
	baselineStarted   chan struct{}
	releaseBaseline   chan struct{}
	fullRetry         chan struct{}
	mu                sync.Mutex
	fullCalls         int
	incrementalCalled bool
}

func (i *failingBaselineProjectIndexer) IndexProjectAstPatch(ctx context.Context, root, _, _ string) (projectindex.IndexPatch, error) {
	i.mu.Lock()
	i.fullCalls++
	call := i.fullCalls
	i.mu.Unlock()
	if call == 1 {
		close(i.baselineStarted)
		select {
		case <-i.releaseBaseline:
		case <-ctx.Done():
			return projectindex.IndexPatch{}, ctx.Err()
		}
		return projectindex.IndexPatch{}, errors.New("initial index failed")
	}
	select {
	case i.fullRetry <- struct{}{}:
	default:
	}
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseAST,
		Project:       store.ProjectIdentity{Root: root, Name: "project"},
		Status:        "ok",
		Invalidates:   &projectindex.IndexPatchInvalidation{All: true},
	}, nil
}

func (i *failingBaselineProjectIndexer) IndexProjectIncremental(context.Context, string, string, string, store.IndexData, []string, []string, string) (projectindex.ProjectIndexIncrementalResult, error) {
	i.mu.Lock()
	i.incrementalCalled = true
	i.mu.Unlock()
	return projectindex.ProjectIndexIncrementalResult{}, nil
}

func (i *blockingLifecycleProjectIndexer) IndexProjectAstPatch(ctx context.Context, root, _, _ string) (projectindex.IndexPatch, error) {
	i.baselineOnce.Do(func() { close(i.baselineStarted) })
	select {
	case <-i.releaseBaseline:
	case <-ctx.Done():
		return projectindex.IndexPatch{}, ctx.Err()
	}
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseAST,
		Project:       store.ProjectIdentity{Root: root, Name: "project"},
		Status:        "ok",
		Invalidates:   &projectindex.IndexPatchInvalidation{All: true},
		Facts: projectindex.IndexPatchFacts{
			Sources: []store.IndexSourceFile{{File: filepath.Join(root, "prompt.ts"), Status: "indexed", ShardID: "."}},
			SourceGraph: &store.ProjectIndexSourceGraph{
				SchemaVersion: 1,
				Capabilities:  []string{"project-shards"},
				Shards:        []store.ProjectIndexShard{{ID: ".", Root: root}},
			},
		},
	}, nil
}

func (i *blockingLifecycleProjectIndexer) IndexProjectIncremental(_ context.Context, _ string, _ string, _ string, _ store.IndexData, files, _ []string, _ string) (projectindex.ProjectIndexIncrementalResult, error) {
	i.incremental <- append([]string(nil), files...)
	return projectindex.ProjectIndexIncrementalResult{}, nil
}

func TestQuietDevServerDoesNotReplaceProcessLogger(t *testing.T) {
	root := t.TempDir()
	t.Chdir(root)
	started := make(chan struct{})
	finish := make(chan struct{})
	opts := devServerTestOptions(t, findFreePort())
	opts.Quiet = true
	opts.ProjectIndexer = fakeProjectIndexer{}
	opts.RuntimeArtifacts = func(context.Context, string, []store.ProjectDefinition) error {
		close(started)
		<-finish
		return nil
	}

	previous := slog.Default()
	var processLogs bytes.Buffer
	processLogger := slog.New(slog.NewTextHandler(&processLogs, nil))
	slog.SetDefault(processLogger)
	t.Cleanup(func() { slog.SetDefault(previous) })

	srv := NewDevServer(opts)
	if err := srv.Start(); err != nil {
		t.Fatalf("start server: %v", err)
	}
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })
	<-started
	slog.Info("concurrent process log")
	close(finish)

	if slog.Default() != processLogger {
		t.Fatal("quiet dev server replaced the process-global logger")
	}
	if !strings.Contains(processLogs.String(), "concurrent process log") {
		t.Fatalf("concurrent process log was redirected by quiet server: %q", processLogs.String())
	}
	if strings.Contains(processLogs.String(), "serving embedded UI") {
		t.Fatalf("quiet server diagnostics escaped to process logger: %q", processLogs.String())
	}
}

func findFreePort() int {
	for port := 14400; port < 14500; port++ {
		if IsPortAvailable(port) {
			return port
		}
	}
	return 14400
}

func TestNewDevServerLoadsPersistentIngestToken(t *testing.T) {
	tokenPath := filepath.Join(t.TempDir(), ".crux", "devtools", "ingest-token")
	if err := os.MkdirAll(filepath.Dir(tokenPath), 0o700); err != nil {
		t.Fatalf("mkdir token dir: %v", err)
	}
	if err := os.WriteFile(tokenPath, []byte("persisted-ingest-token\n"), 0o600); err != nil {
		t.Fatalf("write token: %v", err)
	}

	srv := NewDevServer(DevServerOptions{
		Port:                findFreePort(),
		InspectDir:          t.TempDir(),
		ObservabilityDBPath: filepath.Join(t.TempDir(), "observability.sqlite"),
		IngestTokenPath:     tokenPath,
	})
	defer srv.Shutdown(context.Background())

	if srv.IngestToken != "persisted-ingest-token" {
		t.Fatalf("IngestToken = %q, want persisted-ingest-token", srv.IngestToken)
	}
	if srv.IngestTokenPath != tokenPath {
		t.Fatalf("IngestTokenPath = %q, want %q", srv.IngestTokenPath, tokenPath)
	}
}

func devServerTestOptions(t *testing.T, port int) DevServerOptions {
	t.Helper()
	dir := t.TempDir()
	return DevServerOptions{
		Port:                port,
		InspectDir:          filepath.Join(dir, "evals"),
		ObservabilityDBPath: filepath.Join(dir, "observability.sqlite"),
		IngestTokenPath:     filepath.Join(dir, ".crux", "devtools", "ingest-token"),
		RuntimeArtifacts: func(context.Context, string, []store.ProjectDefinition) error {
			return nil
		},
	}
}

func TestDevServerStartsInitialRuntimeArtifactsAfterListenerStart(t *testing.T) {
	root := t.TempDir()
	t.Chdir(root)
	calls := make(chan runtimeArtifactCall, 1)
	opts := devServerTestOptions(t, findFreePort())
	opts.ProjectIndexer = fakeProjectIndexer{
		index: store.IndexData{
			Definitions: []store.ProjectDefinition{
				{ID: "flow:startup", Kind: "flow", Name: "startup"},
			},
		},
	}
	opts.RuntimeArtifacts = func(_ context.Context, gotRoot string, definitions []store.ProjectDefinition) error {
		calls <- runtimeArtifactCall{
			root:        gotRoot,
			definitions: definitions,
		}
		return nil
	}

	srv := NewDevServer(opts)
	defer srv.Shutdown(context.Background())
	select {
	case <-calls:
		t.Fatal("runtime artifact generation started before server Start")
	default:
	}
	if err := srv.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	select {
	case got := <-calls:
		if got.root != root {
			t.Fatalf("runtime artifact root = %q, want %q", got.root, root)
		}
		if got, want := len(got.definitions), 1; got != want {
			t.Fatalf("runtime artifact definitions = %d, want %d", got, want)
		}
		if got.definitions[0].ID != "flow:startup" {
			t.Fatalf("runtime artifact definition id = %q, want flow:startup", got.definitions[0].ID)
		}
	case <-time.After(time.Second):
		t.Fatal("runtime artifact generation did not run after server Start")
	}
}

func TestRuntimeArtifactRefreshInvalidatesStalePrivacyPolicyBeforeGeneration(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, ".crux", "generated", "runtime", "privacy.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"schemaVersion":1,"privacyFingerprint":"d2b7a3a9e0d3857b24b871ee585d118490dabd9edf81bcf10de9f5328e85cc29","redactPaths":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	expected := errors.New("generation failed")
	generate := privacyGuardedRuntimeArtifactGenerator(func(context.Context, string, []store.ProjectDefinition) error {
		if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("privacy snapshot remained visible during generation: %v", err)
		}
		return expected
	})
	if err := generate(context.Background(), root, nil); !errors.Is(err, expected) {
		t.Fatalf("generation error = %v", err)
	}
	if _, err := privacy.Generated(root).Current(); !errors.Is(err, privacy.ErrPolicyUnavailable) {
		t.Fatalf("policy error = %v, want unavailable", err)
	}
}

func TestRuntimeArtifactGeneratorForWorkerReusesWorker(t *testing.T) {
	worker := &recordingRuntimeArtifactWorker{}
	generate := runtimeArtifactGeneratorForWorker(worker)

	firstDefinitions := []store.ProjectDefinition{{ID: "prompt:one", Kind: "prompt", Name: "one"}}
	secondDefinitions := []store.ProjectDefinition{{ID: "task:two", Kind: "task", Name: "two"}}

	if err := generate(context.Background(), "/project/one", firstDefinitions); err != nil {
		t.Fatalf("first runtime artifact generation: %v", err)
	}
	if err := generate(context.Background(), "/project/two", secondDefinitions); err != nil {
		t.Fatalf("second runtime artifact generation: %v", err)
	}

	if got, want := worker.roots, []string{"/project/one", "/project/two"}; fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("worker roots = %#v, want %#v", got, want)
	}
	if got, want := worker.definitionIDs, []string{"prompt:one", "task:two"}; fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("worker definition ids = %#v, want %#v", got, want)
	}
}

func TestRuntimeArtifactStartupDiagnosticRetainsEveryFinding(t *testing.T) {
	diagnostic := runtimeArtifactStartupDiagnostic(&eventwire.WorkerEventError{
		Scope: "artifact",
		Code:  "RUNTIME_ARTIFACT_GENERATION_FAILED",
		Findings: []eventwire.RuntimeArtifactFinding{
			{
				Code: "RUNTIME_EVAL_INVALID", Category: "authored", FeatureKind: "eval", FeatureID: "answer",
				Arm: "current", Source: "evals/answer.eval.ts", Summary: "Eval answer is not ready.",
				Reason: "Eval task must be callable.", WhatStillWorks: "Other Evals still work.",
				Remediation: "Pass a callable task and save the file.", Docs: "https://cruxjs.dev/docs/evals",
			},
			{
				Code: "RUNTIME_ARTIFACT_INTERNAL", Category: "internal", Summary: "Crux could not verify the index.",
				Reason: "The index snapshot was inconsistent.",
			},
		},
	})

	if diagnostic.Code != "RUNTIME_ARTIFACT_GENERATION_FAILED" || !strings.Contains(diagnostic.Message, "2 issues") {
		t.Fatalf("aggregate diagnostic = %#v, want typed summary and count", diagnostic)
	}
	if len(diagnostic.Children) != 2 {
		t.Fatalf("children = %#v, want both worker findings", diagnostic.Children)
	}
	first := diagnostic.Children[0]
	if first.Category != "authored" || first.FeatureKind != "eval" || first.FeatureID != "answer" || first.Arm != "current" || first.Source != "evals/answer.eval.ts" || first.Reason != "Eval task must be callable." || first.WhatStillWorks != "Other Evals still work." || first.Docs != "https://cruxjs.dev/docs/evals" {
		t.Fatalf("child metadata = %#v, want lossless worker finding", first)
	}
	if !strings.Contains(diagnostic.Children[0].Remediation, "retry automatically") {
		t.Fatalf("authored remediation = %q, want watcher retry copy", diagnostic.Children[0].Remediation)
	}
	if diagnostic.Children[1].Remediation != "" {
		t.Fatalf("internal remediation = %q, want no invented user action", diagnostic.Children[1].Remediation)
	}
	if strings.Contains(strings.ToLower(fmt.Sprint(diagnostic)), "descriptor") || strings.Contains(diagnostic.Remediation, "runtime generate") {
		t.Fatalf("diagnostic uses internal jargon or tells active watcher to rerun: %#v", diagnostic)
	}
}

func TestRuntimeArtifactStartupDiagnosticDoesNotBlameUserForUnknownFailure(t *testing.T) {
	diagnostic := runtimeArtifactStartupDiagnostic(errors.New("unexpected worker failure"))

	if diagnostic.Remediation != "" {
		t.Fatalf("remediation = %q, want no invented user action", diagnostic.Remediation)
	}
	if strings.Contains(diagnostic.Message, "unexpected worker failure") {
		t.Fatalf("message = %q, want stable non-blaming copy", diagnostic.Message)
	}
}

type recordingRuntimeArtifactWorker struct {
	roots         []string
	definitionIDs []string
}

func (w *recordingRuntimeArtifactWorker) GenerateRuntimeArtifacts(_ context.Context, root string, definitions []store.ProjectDefinition) (json.RawMessage, error) {
	w.roots = append(w.roots, root)
	if len(definitions) > 0 {
		w.definitionIDs = append(w.definitionIDs, definitions[0].ID)
	}
	return json.RawMessage(`{}`), nil
}

type runtimeArtifactCall struct {
	root        string
	definitions []store.ProjectDefinition
}

func TestDevServer_start_and_query(t *testing.T) {
	port := findFreePort()
	srv := NewDevServer(devServerTestOptions(t, port))

	if err := srv.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	defer srv.Shutdown(context.Background())

	// Give server a moment to start listening
	time.Sleep(50 * time.Millisecond)

	// Should be able to hit /api/stats
	resp, err := http.Get(fmt.Sprintf("http://localhost:%d/api/stats", port))
	if err != nil {
		t.Fatalf("GET /api/stats error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}

	var stats store.StatsResult
	if err := json.NewDecoder(resp.Body).Decode(&stats); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}
}

func TestDevServer_ingest_and_read(t *testing.T) {
	port := findFreePort()
	srv := NewDevServer(devServerTestOptions(t, port))

	if err := srv.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	defer srv.Shutdown(context.Background())

	time.Sleep(50 * time.Millisecond)

	baseURL := fmt.Sprintf("http://localhost:%d", port)

	body := `{"schemaVersion":5,"records":[
		{"schemaVersion":5,"recordId":"rec_run_start","type":"run:start","runId":"run-live","operationId":"run-live","segmentId":"seg-live","segmentSeq":1,"traceId":"trace-live","name":"live","rootPrimitive":"generation.call","startedAt":"2026-05-16T18:00:00.000Z","status":"running"},
		{"schemaVersion":5,"recordId":"rec_run_end","type":"run:end","runId":"run-live","operationId":"run-live","segmentId":"seg-live","segmentSeq":2,"traceId":"trace-live","endedAt":"2026-05-16T18:00:00.010Z","durationMs":10,"status":"ok"}
	]}`
	resp, err := http.Post(baseURL+"/api/observability/records", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST error: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("POST status = %d, want %d", resp.StatusCode, http.StatusAccepted)
	}

	resp, err = http.Get(baseURL + "/api/observability/runs/page")
	if err != nil {
		t.Fatalf("GET error: %v", err)
	}
	defer resp.Body.Close()

	var page observability.RunsResponse
	if err := json.NewDecoder(resp.Body).Decode(&page); err != nil {
		t.Fatalf("decode runs page: %v", err)
	}
	if page.Revision == 0 {
		t.Fatal("page.Revision was not populated")
	}
	if len(page.Rows) != 1 || page.Rows[0].RunID != "run-live" || page.Rows[0].Status != "ok" {
		t.Errorf("page.Rows = %#v, want run-live ok", page.Rows)
	}
}
