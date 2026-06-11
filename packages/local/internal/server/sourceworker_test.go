package server

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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

	_, err := worker.ResolveLocations(context.Background(), []SourceLocation{{File: "/bundle.js", Line: 1}})
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

	_, err := worker.ResolveLocations(context.Background(), []SourceLocation{{File: "/bundle.js", Line: 1}})
	if err == nil {
		t.Fatal("ResolveLocations error = nil, want worker error")
	}
	if !strings.Contains(err.Error(), "source-resolver worker: bad request") {
		t.Fatalf("ResolveLocations error = %v, want worker error", err)
	}
}

func writeSourceWorkerScript(path string, script string) error {
	return os.WriteFile(path, []byte(script), 0o600)
}
