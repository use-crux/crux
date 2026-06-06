package server

import (
	"bufio"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSourceWorker_scanLineHandlesMissingReader(t *testing.T) {
	result := scanSourceWorkerLine(nil, sourceWorkerMaxResponseBytes)
	if result.err == nil {
		t.Fatal("scanSourceWorkerLine(nil) error = nil, want stdout unavailable error")
	}
	if !strings.Contains(result.err.Error(), "stdout unavailable") {
		t.Fatalf("error = %q, want stdout unavailable", result.err)
	}
}

func TestSourceWorker_scanLineRejectsOversizedResponse(t *testing.T) {
	reader := bufio.NewReader(strings.NewReader(strings.Repeat("x", 32) + "\n"))

	result := scanSourceWorkerLine(reader, 8)

	if result.err == nil {
		t.Fatal("scanSourceWorkerLine error = nil, want oversized response error")
	}
	if !strings.Contains(result.err.Error(), "response exceeded") {
		t.Fatalf("scanSourceWorkerLine error = %v, want response exceeded", result.err)
	}
}

func TestSourceWorker_scanLineUsesCapturedReaderAfterWorkerReset(t *testing.T) {
	reader, writer := io.Pipe()
	defer reader.Close()
	defer writer.Close()

	worker := &SourceWorker{stdout: bufio.NewReader(reader)}
	capturedStdout := worker.stdout
	resultCh := make(chan sourceWorkerScanResult, 1)
	go func() {
		resultCh <- scanSourceWorkerLine(capturedStdout, sourceWorkerMaxResponseBytes)
	}()

	worker.stdout = nil
	if _, err := writer.Write([]byte(`{"locations":[]}` + "\n")); err != nil {
		t.Fatalf("write reader input: %v", err)
	}

	select {
	case result := <-resultCh:
		if result.err != nil {
			t.Fatalf("scan error = %v, want nil", result.err)
		}
		if got, want := string(result.bytes), `{"locations":[]}`; got != want {
			t.Fatalf("scan bytes = %q, want %q", got, want)
		}
	case <-time.After(time.Second):
		t.Fatal("scan timed out")
	}
}

func TestSourceWorker_resolveLocationsReportsMalformedJSONResponse(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "malformed-source-worker.mjs")
	if err := writeSourceWorkerScript(script, `
		process.stdin.setEncoding('utf8')
		process.stdin.once('data', () => {
			process.stdout.write('not-json\n')
		})
	`); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := NewSourceWorker(script)
	defer worker.Close()

	_, err := worker.ResolveLocations([]SourceLocation{{File: "/bundle.js", Line: 1}})
	if err == nil {
		t.Fatal("ResolveLocations error = nil, want unmarshal error")
	}
	if !strings.Contains(err.Error(), "unmarshal response") {
		t.Fatalf("ResolveLocations error = %v, want unmarshal response", err)
	}
}

func TestSourceWorker_resolveLocationsReportsWorkerErrorResponse(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "error-source-worker.mjs")
	if err := writeSourceWorkerScript(script, `
		process.stdin.setEncoding('utf8')
		process.stdin.once('data', () => {
			process.stdout.write(JSON.stringify({ error: 'bad request' }) + '\n')
		})
	`); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := NewSourceWorker(script)
	defer worker.Close()

	_, err := worker.ResolveLocations([]SourceLocation{{File: "/bundle.js", Line: 1}})
	if err == nil {
		t.Fatal("ResolveLocations error = nil, want worker error")
	}
	if !strings.Contains(err.Error(), "source resolver worker: bad request") {
		t.Fatalf("ResolveLocations error = %v, want worker error", err)
	}
}

func writeSourceWorkerScript(path string, script string) error {
	return os.WriteFile(path, []byte(script), 0o600)
}
