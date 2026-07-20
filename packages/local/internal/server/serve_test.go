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
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/privacy"
	"github.com/use-crux/crux/packages/local/internal/store"
)

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

	serverReady := make(chan *DevServer, 1)
	go func() { serverReady <- NewDevServer(opts) }()
	<-started
	slog.Info("concurrent process log")
	close(finish)
	srv := <-serverReady
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })

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

func TestNewDevServerGeneratesRuntimeArtifactsBeforeMutationRoutesAreExposed(t *testing.T) {
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
	default:
		t.Fatal("runtime artifact generation did not finish before NewDevServer returned")
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

	body := `{"schemaVersion":2,"records":[
		{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run-live","segmentId":"seg-live","segmentSeq":1,"traceId":"trace-live","name":"live","rootPrimitive":"generation.call","startedAt":"2026-05-16T18:00:00.000Z","status":"running"},
		{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run-live","segmentId":"seg-live","segmentSeq":2,"traceId":"trace-live","endedAt":"2026-05-16T18:00:00.010Z","durationMs":10,"status":"ok"}
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
