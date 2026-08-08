//go:build linux

package anydocsupervisor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestSystemdContainmentIntegration is intentionally a real system-bus test.
// It uses the packaged runner and a canonical DOCX, but does not register any
// public format route. The environment gate makes it safe to keep in normal
// Go test runs while CI turns missing systemd support into a hard failure.
func TestSystemdContainmentIntegration(t *testing.T) {
	requireSystemdIntegration(t)
	if os.Geteuid() != 0 {
		t.Fatal("systemd containment integration requires root on the system bus")
	}
	if _, err := os.Stat("/run/dbus/system_bus_socket"); err != nil {
		t.Fatalf("system bus unavailable: %v", err)
	}

	input, err := os.ReadFile(filepath.Join("..", "..", "..", "ingest", "evals", "anydoc", "fixtures", "prose.docx"))
	if err != nil {
		t.Fatal(err)
	}
	launch, err := PrepareLocalHost()
	if err != nil {
		t.Fatalf("prepare embedded Anydoc runtime and attested Node: %v", err)
	}
	t.Cleanup(func() { makeWritableTree(t, launch.runtimeRoot) })

	root, err := os.MkdirTemp("/run", "crux-anydoc-integration-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	stagingRoot := filepath.Join(root, "input")
	privateTemp := filepath.Join(root, "private")
	for _, path := range []string{stagingRoot, privateTemp} {
		if err := os.Mkdir(path, 0o700); err != nil {
			t.Fatal(err)
		}
	}

	backend := NewSystemdBackend()
	supervisor := NewWithStager(backend, NewStager(stagingRoot))
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	run, err := supervisor.Start(ctx, input, launch, privateTemp, Limits{
		MemoryMax:       128 << 20,
		TasksMax:        8,
		CPUQuotaPercent: 50,
		RuntimeMax:      20 * time.Second,
	})
	if err != nil {
		t.Fatalf("start transient service: %v", err)
	}

	if err := run.Authorize(); err != nil {
		_ = run.Finish(context.Background(), err)
		t.Fatalf("authorize one-shot job: %v", err)
	}
	result, err := run.Execute(ctx)
	if err != nil {
		t.Fatalf("execute packaged runner: %v", err)
	}
	if !result.OK || result.Accounting == nil || result.Accounting.SourceBytes != int64(len(input)) || result.SourceSHA256 != sha256Hex(input) || result.Format != "docx" {
		t.Fatalf("unbound or invalid runner result: %#v", result)
	}
	assertIntegrationCleanup(t, root, stagingRoot, privateTemp, run)
	writeContainmentEvidence(t, result, run.TerminalReport())
}

func assertIntegrationCleanup(t *testing.T, root, stagingRoot, privateTemp string, run *Run) {
	t.Helper()
	if run == nil || run.unit == nil {
		t.Fatal("missing completed unit")
	}
	report := run.TerminalReport()
	if !report.Cleaned || report.Sandbox.Populated {
		t.Fatal("transient unit cgroup remained populated")
	}
	entries, err := os.ReadDir(stagingRoot)
	if err != nil {
		t.Fatalf("inspect staged-input cleanup: %v", err)
	}
	if len(entries) != 0 {
		t.Fatal("cleanup retained staged input")
	}
	if _, err := os.Stat(privateTemp); !os.IsNotExist(err) {
		t.Fatalf("cleanup retained private temporary directory: %v", err)
	}
	if _, err := os.Stat(root); err != nil {
		t.Fatalf("integration root unexpectedly disappeared: %v", err)
	}
}

func writeContainmentEvidence(t *testing.T, result Result, terminal TerminalReport) {
	t.Helper()
	path := os.Getenv("CRUX_SYSTEMD_EVIDENCE_PATH")
	if path == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	// Deliberately omit source paths and payload: the artifact is containment
	// evidence, not a document-exfiltration channel.
	evidence := struct {
		Format        string           `json:"format"`
		SourceSHA256  string           `json:"sourceSha256"`
		SourceBytes   int64            `json:"sourceBytes"`
		ResultBytes   int              `json:"resultBytes"`
		Outcome       ErrorCode        `json:"outcome"`
		Cleaned       bool             `json:"cleaned"`
		MemoryMax     int64            `json:"memoryMax"`
		MemoryCurrent int64            `json:"memoryCurrent"`
		MemoryEvents  map[string]int64 `json:"memoryEvents"`
		TasksMax      int              `json:"tasksMax"`
		CPUUsec       int64            `json:"cpuUsec"`
		WallMillis    int64            `json:"wallMillis"`
	}{result.Format, result.SourceSHA256, result.SourceBytes, len(result.Payload), terminal.Outcome, terminal.Cleaned, terminal.Sandbox.MemoryMax, terminal.Sandbox.MemoryCurrent, terminal.Sandbox.MemoryEvents, terminal.Sandbox.TasksMax, terminal.CPU.Microseconds(), terminal.Wall.Milliseconds()}
	if evidence.MemoryMax > MemoryCeiling/2 {
		t.Fatal("integration memory ceiling exceeds half the production ceiling")
	}
	bytes, err := json.Marshal(evidence)
	if err != nil {
		t.Fatal(err)
	}
	if len(bytes) > 1024 {
		t.Fatal("containment evidence exceeded bound")
	}
	if err := os.WriteFile(path, bytes, 0o600); err != nil {
		t.Fatal(err)
	}
}

func sha256Hex(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

func makeWritableTree(t *testing.T, root string) {
	t.Helper()
	_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err == nil && info.IsDir() {
			_ = os.Chmod(path, 0o755)
		}
		return nil
	})
}
