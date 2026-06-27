package source

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorker_resolveLocationsReportsMalformedJSONResponse(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "malformed-source-worker.mjs")
	if err := writeWorkerScript(script, `
		process.stdin.setEncoding('utf8')
		process.stdin.once('data', () => {
			process.stdout.write('not-json\n')
		})
	`); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := New(script, nil)
	defer worker.Close()

	_, err := worker.ResolveLocations(context.Background(), []Location{{File: "/bundle.js", Line: 1}})
	if err == nil {
		t.Fatal("ResolveLocations error = nil, want unmarshal error")
	}
	if !strings.Contains(err.Error(), "unmarshal response") {
		t.Fatalf("ResolveLocations error = %v, want unmarshal response", err)
	}
}

func TestWorker_resolveLocationsReportsWorkerErrorResponse(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "error-source-worker.mjs")
	if err := writeWorkerScript(script, `
		process.stdin.setEncoding('utf8')
		process.stdin.once('data', () => {
			process.stdout.write(JSON.stringify({ error: 'bad request' }) + '\n')
		})
	`); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := New(script, nil)
	defer worker.Close()

	_, err := worker.ResolveLocations(context.Background(), []Location{{File: "/bundle.js", Line: 1}})
	if err == nil {
		t.Fatal("ResolveLocations error = nil, want worker error")
	}
	if !strings.Contains(err.Error(), "source-resolver worker: bad request") {
		t.Fatalf("ResolveLocations error = %v, want worker error", err)
	}
}

func TestWorker_resolveSourceFrame(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "source-frame-worker.mjs")
	if err := writeWorkerScript(script, `
		process.stdin.setEncoding('utf8')
		process.stdin.once('data', (data) => {
			const req = JSON.parse(data)
			process.stdout.write(JSON.stringify({
				kind: 'source-frame',
				sourceRef: req.sourceRef,
				authoredFile: '/project/evals/support.eval.ts',
				authoredLine: 42,
				authoredColumn: req.column,
				frameStartLine: 40,
				frameEndLine: 44,
				lines: [
					{ line: 42, text: 'ctx.expect(output).toBe("ok")', role: req.role }
				],
				contentHash: 'sha256:test-frame',
				capturedAt: req.capturedAt,
				stale: false,
				resolver: 'source-map'
			}) + '\n')
		})
	`); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := New(script, nil)
	defer worker.Close()

	column := 8
	radius := 2
	result, err := worker.ResolveFrame(context.Background(), FrameRequest{
		File:        "/project/dist/eval.js",
		Line:        1,
		Column:      &column,
		SourceRef:   "/project/dist/eval.js:1:8",
		FrameRadius: &radius,
		Role:        "failed",
		CapturedAt:  "2026-06-15T12:00:00.000Z",
	})
	if err != nil {
		t.Fatalf("ResolveFrame error = %v", err)
	}
	if result.Kind != "source-frame" || result.AuthoredFile != "/project/evals/support.eval.ts" {
		t.Fatalf("ResolveFrame result = %#v", result)
	}
	if len(result.Lines) != 1 || result.Lines[0].Role != "failed" {
		t.Fatalf("ResolveFrame lines = %#v", result.Lines)
	}
}

func writeWorkerScript(path string, script string) error {
	return os.WriteFile(path, []byte(script), 0o600)
}
