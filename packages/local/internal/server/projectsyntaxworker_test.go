package server

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

func TestProjectSyntaxWorkerParsesFileThroughCommandWorker(t *testing.T) {
	worker := NewProjectSyntaxWorker(shellPath(t), fakeSyntaxWorker(t))
	defer worker.Close()

	record, err := worker.ParseFile(context.Background(), ProjectSyntaxParseRequest{
		Root:             "/repo",
		File:             "/repo/src/policy.ts",
		Source:           "export const policy = definePolicy({ id: 'tenant' })",
		CallNames:        []string{"definePolicy"},
		ConstructorNames: []string{"Agent"},
	})
	if err != nil {
		t.Fatalf("ParseFile error = %v", err)
	}

	var parsed struct {
		SchemaVersion int `json:"schemaVersion"`
		Frontend      struct {
			Name string `json:"name"`
		} `json:"frontend"`
		Matches []struct {
			VariableName string `json:"variableName"`
		} `json:"matches"`
	}
	if err := json.Unmarshal(record, &parsed); err != nil {
		t.Fatalf("unmarshal record: %v", err)
	}
	if parsed.SchemaVersion != 1 || parsed.Frontend.Name != "test-rust" {
		t.Fatalf("record identity = schema %d frontend %q, want schema 1 test-rust", parsed.SchemaVersion, parsed.Frontend.Name)
	}
	if len(parsed.Matches) != 1 || parsed.Matches[0].VariableName != "policy" {
		t.Fatalf("record matches = %#v, want policy match", parsed.Matches)
	}
}

func TestProjectSyntaxWorkerCommandPathUsesExplicitEnv(t *testing.T) {
	t.Setenv(projectIndexerSyntaxWorkerEnv, "/opt/crux/crux-indexer-syntax")

	got, ok := projectSyntaxWorkerCommandPath()
	if !ok {
		t.Fatalf("projectSyntaxWorkerCommandPath() ok = false, want true")
	}
	if got != "/opt/crux/crux-indexer-syntax" {
		t.Fatalf("projectSyntaxWorkerCommandPath() = %q, want explicit env path", got)
	}
}

func TestProjectSyntaxWorkerCommandPathDiscoversBundledSibling(t *testing.T) {
	oldExecutable := osExecutable
	t.Cleanup(func() { osExecutable = oldExecutable })
	t.Setenv(projectIndexerSyntaxWorkerEnv, "")

	dir := t.TempDir()
	executable := filepath.Join(dir, "crux-test")
	if err := os.WriteFile(executable, []byte("test"), 0o700); err != nil {
		t.Fatalf("write fake executable: %v", err)
	}
	worker := filepath.Join(dir, projectSyntaxWorkerBinaryName())
	if err := os.WriteFile(worker, []byte("test"), 0o700); err != nil {
		t.Fatalf("write fake syntax worker: %v", err)
	}
	osExecutable = func() (string, error) {
		return executable, nil
	}

	got, ok := projectSyntaxWorkerCommandPath()
	if !ok {
		t.Fatalf("projectSyntaxWorkerCommandPath() ok = false, want true")
	}
	if got != worker {
		t.Fatalf("projectSyntaxWorkerCommandPath() = %q, want bundled worker %q", got, worker)
	}
}

func TestProjectSyntaxWorkerCommandPathMissingWhenNoEnvOrSibling(t *testing.T) {
	oldExecutable := osExecutable
	t.Cleanup(func() { osExecutable = oldExecutable })
	t.Setenv(projectIndexerSyntaxWorkerEnv, "")

	dir := t.TempDir()
	executable := filepath.Join(dir, "crux-test")
	if err := os.WriteFile(executable, []byte("test"), 0o700); err != nil {
		t.Fatalf("write fake executable: %v", err)
	}
	osExecutable = func() (string, error) {
		return executable, nil
	}

	if got, ok := projectSyntaxWorkerCommandPath(); ok {
		t.Fatalf("projectSyntaxWorkerCommandPath() = %q, true; want no worker", got)
	}
}

func TestProjectSyntaxWorkerPoolParsesFilesThroughCommandWorkers(t *testing.T) {
	pool := NewProjectSyntaxWorkerPool(2, shellPath(t), fakeEchoSyntaxWorker(t))
	defer pool.Close()

	if got := pool.Concurrency(); got != 2 {
		t.Fatalf("Concurrency() = %d, want 2", got)
	}

	files := []string{"/repo/src/one.ts", "/repo/src/two.ts", "/repo/src/three.ts", "/repo/src/four.ts"}
	var wg sync.WaitGroup
	errs := make(chan error, len(files))
	for _, file := range files {
		file := file
		wg.Add(1)
		go func() {
			defer wg.Done()
			record, err := pool.ParseFile(context.Background(), ProjectSyntaxParseRequest{
				Root:      "/repo",
				File:      file,
				Source:    "export const value = prompt({ id: 'value' })",
				CallNames: []string{"prompt"},
			})
			if err != nil {
				errs <- err
				return
			}
			if !strings.Contains(string(record), file) {
				errs <- &syntaxWorkerTestError{message: "record did not preserve file " + file + ": " + string(record)}
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestProjectSyntaxWorkerParsesFilesThroughBatchCommandWorker(t *testing.T) {
	worker := NewProjectSyntaxWorker(shellPath(t), fakeStreamingBatchSyntaxWorker(t))
	defer worker.Close()

	records, err := worker.ParseFiles(context.Background(), []ProjectSyntaxParseRequest{
		{
			Root:      "/repo",
			File:      "/repo/src/one.ts",
			Source:    "export const one = prompt({ id: 'one' })",
			CallNames: []string{"prompt"},
		},
		{
			Root:      "/repo",
			File:      "/repo/src/two.ts",
			Source:    "export const two = prompt({ id: 'two' })",
			CallNames: []string{"prompt"},
		},
	})
	if err != nil {
		t.Fatalf("ParseFiles error = %v", err)
	}
	if len(records) != 2 {
		t.Fatalf("records = %d, want 2", len(records))
	}
	if !strings.Contains(string(records[0]), "/repo/src/one.ts") || !strings.Contains(string(records[1]), "/repo/src/two.ts") {
		t.Fatalf("records did not preserve order: %s %s", records[0], records[1])
	}
}

func TestProjectSyntaxWorkerStreamsBatchRecords(t *testing.T) {
	worker := NewProjectSyntaxWorker(shellPath(t), fakeStreamingBatchSyntaxWorker(t))
	defer worker.Close()

	var indexes []int
	var records []json.RawMessage
	err := worker.ParseFilesStream(context.Background(), []ProjectSyntaxParseRequest{
		{
			Root:      "/repo",
			File:      "/repo/src/one.ts",
			Source:    "export const one = prompt({ id: 'one' })",
			CallNames: []string{"prompt"},
		},
		{
			Root:      "/repo",
			File:      "/repo/src/two.ts",
			Source:    "export const two = prompt({ id: 'two' })",
			CallNames: []string{"prompt"},
		},
	}, func(index int, record json.RawMessage) error {
		indexes = append(indexes, index)
		records = append(records, append(json.RawMessage(nil), record...))
		return nil
	})
	if err != nil {
		t.Fatalf("ParseFilesStream error = %v", err)
	}
	if got := fmt.Sprint(indexes); got != "[0 1]" {
		t.Fatalf("streamed indexes = %s, want [0 1]", got)
	}
	if len(records) != 2 ||
		!strings.Contains(string(records[0]), "/repo/src/one.ts") ||
		!strings.Contains(string(records[1]), "/repo/src/two.ts") {
		t.Fatalf("streamed records did not preserve worker records: %s %s", records[0], records[1])
	}
}

func TestProjectSyntaxWorkerParsesFilesThroughOutOfOrderStreamingBatch(t *testing.T) {
	worker := NewProjectSyntaxWorker(shellPath(t), fakeOutOfOrderStreamingBatchSyntaxWorker(t))
	defer worker.Close()

	records, err := worker.ParseFiles(context.Background(), []ProjectSyntaxParseRequest{
		{Root: "/repo", File: "/repo/src/one.ts", ReadSourceFromDisk: true, CallNames: []string{"prompt"}},
		{Root: "/repo", File: "/repo/src/two.ts", ReadSourceFromDisk: true, CallNames: []string{"prompt"}},
	})
	if err != nil {
		t.Fatalf("ParseFiles error = %v", err)
	}
	if !strings.Contains(string(records[0]), "/repo/src/one.ts") || !strings.Contains(string(records[1]), "/repo/src/two.ts") {
		t.Fatalf("records did not preserve indexed order: %s %s", records[0], records[1])
	}
}

func TestProjectSyntaxWorkerPoolStreamsBatchAcrossWorkers(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "workers.log")
	pool := NewProjectSyntaxWorkerPool(2, shellPath(t), fakeCountingBatchSyntaxWorker(t, logPath))
	defer pool.Close()

	requests := []ProjectSyntaxParseRequest{
		{Root: "/repo", File: "/repo/src/one.ts", ReadSourceFromDisk: true, CallNames: []string{"prompt"}},
		{Root: "/repo", File: "/repo/src/two.ts", ReadSourceFromDisk: true, CallNames: []string{"prompt"}},
		{Root: "/repo", File: "/repo/src/three.ts", ReadSourceFromDisk: true, CallNames: []string{"prompt"}},
		{Root: "/repo", File: "/repo/src/four.ts", ReadSourceFromDisk: true, CallNames: []string{"prompt"}},
	}

	records := make([]json.RawMessage, len(requests))
	err := pool.ParseFilesStream(context.Background(), requests, func(index int, record json.RawMessage) error {
		records[index] = append(json.RawMessage(nil), record...)
		return nil
	})
	if err != nil {
		t.Fatalf("ParseFilesStream error = %v", err)
	}
	for index, record := range records {
		if len(record) == 0 {
			t.Fatalf("record[%d] was not streamed", index)
		}
	}

	workerLog, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read worker log: %v", err)
	}
	distinct := map[string]bool{}
	for _, pid := range strings.Fields(string(workerLog)) {
		distinct[pid] = true
	}
	if len(distinct) < 2 {
		t.Fatalf("worker log = %q, want multiple worker processes", workerLog)
	}
}

func TestProjectSyntaxWorkerPoolParsesBatchAcrossWorkers(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "workers.log")
	pool := NewProjectSyntaxWorkerPool(2, shellPath(t), fakeCountingBatchSyntaxWorker(t, logPath))
	defer pool.Close()

	requests := []ProjectSyntaxParseRequest{
		{Root: "/repo", File: "/repo/src/one.ts", ReadSourceFromDisk: true, CallNames: []string{"prompt"}},
		{Root: "/repo", File: "/repo/src/two.ts", ReadSourceFromDisk: true, CallNames: []string{"prompt"}},
		{Root: "/repo", File: "/repo/src/three.ts", ReadSourceFromDisk: true, CallNames: []string{"prompt"}},
		{Root: "/repo", File: "/repo/src/four.ts", ReadSourceFromDisk: true, CallNames: []string{"prompt"}},
	}

	records, err := pool.ParseFiles(context.Background(), requests)
	if err != nil {
		t.Fatalf("ParseFiles error = %v", err)
	}
	if len(records) != len(requests) {
		t.Fatalf("records = %d, want %d", len(records), len(requests))
	}
	workerLog, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read worker log: %v", err)
	}
	workerPIDs := strings.Fields(string(workerLog))
	if len(workerPIDs) < 2 {
		t.Fatalf("worker log = %q, want at least two batch workers", workerLog)
	}
	distinct := map[string]bool{}
	for _, pid := range workerPIDs {
		distinct[pid] = true
	}
	if len(distinct) < 2 {
		t.Fatalf("worker log = %q, want multiple worker processes", workerLog)
	}
}

func fakeSyntaxWorker(t *testing.T) string {
	t.Helper()
	return writeShellScript(t, "syntax-worker.sh", `while IFS= read -r line; do
case "$line" in
  *definePolicy*) printf '{"id":1,"ok":true,"record":{"schemaVersion":1,"frontend":{"name":"test-rust","version":"1"},"file":"/repo/src/policy.ts","sourceHash":"hash","imports":[],"matches":[{"kind":"call","variableName":"policy","localName":"src/policy.ts:policy","exported":true,"source":{"file":"/repo/src/policy.ts","line":1,"column":23},"callee":{"name":"definePolicy"},"args":[]}],"localInitializers":[],"diagnostics":[]}}\n' ;;
  *) printf '{"id":1,"ok":false,"error":"unexpected request"}\n' ;;
esac
done
`)
}

func fakeEchoSyntaxWorker(t *testing.T) string {
	t.Helper()
	return writeShellScript(t, "syntax-worker-echo.sh", `while IFS= read -r line; do
id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
file=$(printf '%s' "$line" | sed -n 's/.*"file":"\([^"]*\)".*/\1/p')
case "$line" in
  *prompt*) printf '{"id":%s,"ok":true,"record":{"schemaVersion":1,"frontend":{"name":"test-rust","version":"1"},"file":"%s","sourceHash":"hash","imports":[],"matches":[],"localInitializers":[],"diagnostics":[]}}\n' "$id" "$file" ;;
  *) printf '{"id":%s,"ok":false,"error":"unexpected request"}\n' "$id" ;;
esac
done
`)
}

func fakeStreamingBatchSyntaxWorker(t *testing.T) string {
	t.Helper()
	return writeShellScript(t, "syntax-worker-batch.sh", `while IFS= read -r line; do
id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
case "$line" in
  *'"stream":true'*) printf '{"id":%s,"type":"record","index":0,"record":{"schemaVersion":1,"frontend":{"name":"test-rust","version":"1"},"file":"/repo/src/one.ts","sourceHash":"hash","imports":[],"matches":[],"localInitializers":[],"diagnostics":[]}}\n{"id":%s,"type":"record","index":1,"record":{"schemaVersion":1,"frontend":{"name":"test-rust","version":"1"},"file":"/repo/src/two.ts","sourceHash":"hash","imports":[],"matches":[],"localInitializers":[],"diagnostics":[]}}\n{"id":%s,"type":"done","count":2}\n' "$id" "$id" "$id" ;;
  *) printf '{"id":%s,"ok":false,"error":"expected batch request"}\n' "$id" ;;
esac
done
`)
}

func fakeOutOfOrderStreamingBatchSyntaxWorker(t *testing.T) string {
	t.Helper()
	return writeShellScript(t, "syntax-worker-batch-out-of-order.sh", `while IFS= read -r line; do
id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
case "$line" in
  *'"stream":true'*) printf '{"id":%s,"type":"record","index":1,"record":{"schemaVersion":1,"frontend":{"name":"test-rust","version":"1"},"file":"/repo/src/two.ts","sourceHash":"hash","imports":[],"matches":[],"localInitializers":[],"diagnostics":[]}}\n{"id":%s,"type":"record","index":0,"record":{"schemaVersion":1,"frontend":{"name":"test-rust","version":"1"},"file":"/repo/src/one.ts","sourceHash":"hash","imports":[],"matches":[],"localInitializers":[],"diagnostics":[]}}\n{"id":%s,"type":"done","count":2}\n' "$id" "$id" "$id" ;;
  *) printf '{"id":%s,"ok":false,"error":"expected streaming batch request"}\n' "$id" ;;
esac
done
`)
}

func fakeCountingBatchSyntaxWorker(t *testing.T, logPath string) string {
	t.Helper()
	return writeShellScript(t, "syntax-worker-batch-counting.sh", `while IFS= read -r line; do
id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
case "$line" in
  *'"stream":true'*)
    printf '%s\n' "$$" >> `+logPath+`
    count=$(printf '%s' "$line" | grep -o '"file":' | wc -l | tr -d ' ')
    i=0
    while [ "$i" -lt "$count" ]; do
      printf '{"id":%s,"type":"record","index":%s,"record":{"schemaVersion":1,"frontend":{"name":"test-rust","version":"1"},"file":"/repo/src/shard-%s.ts","sourceHash":"hash","imports":[],"matches":[],"localInitializers":[],"diagnostics":[]}}\n' "$id" "$i" "$i"
      i=$((i + 1))
    done
    printf '{"id":%s,"type":"done","count":%s}\n' "$id" "$count"
    ;;
  *) printf '{"id":%s,"ok":false,"error":"expected streaming batch request"}\n' "$id" ;;
esac
done
`)
}

type syntaxWorkerTestError struct {
	message string
}

func (e *syntaxWorkerTestError) Error() string {
	return e.message
}

func writeShellScript(t *testing.T, name string, script string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell script subprocess tests require a POSIX shell")
	}
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
	return path
}

func shellPath(t *testing.T) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell script subprocess tests require a POSIX shell")
	}
	return "/bin/sh"
}
