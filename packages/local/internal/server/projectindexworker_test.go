package server

import (
	"bufio"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestFindNodePathPrefersNVMNode24OverOlderPathNode(t *testing.T) {
	dir := t.TempDir()
	binDir := filepath.Join(dir, "bin")
	nvmBin := filepath.Join(dir, ".nvm", "versions", "node", "v24.16.0", "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("mkdir bin: %v", err)
	}
	if err := os.MkdirAll(nvmBin, 0o755); err != nil {
		t.Fatalf("mkdir nvm bin: %v", err)
	}
	writeFakeNode(t, filepath.Join(binDir, "node"), "v20.20.1")
	node24 := filepath.Join(nvmBin, "node")
	writeFakeNode(t, node24, "v24.16.0")

	t.Setenv("PATH", binDir)
	t.Setenv("HOME", dir)
	t.Setenv("NVM_BIN", "")
	t.Setenv("CRUX_NODE_PATH", "")

	path, err := findNodePath()
	if err != nil {
		t.Fatalf("findNodePath error = %v", err)
	}
	if path != node24 {
		t.Fatalf("findNodePath = %s, want %s", path, node24)
	}
}

func writeFakeNode(t *testing.T, path string, version string) {
	t.Helper()
	if err := os.WriteFile(path, []byte("#!/bin/sh\necho "+version+"\n"), 0o755); err != nil {
		t.Fatalf("write fake node %s: %v", path, err)
	}
}

func TestProjectIndexWorker_scanLineHandlesMissingScanner(t *testing.T) {
	result := scanProjectIndexWorkerLine(nil, projectIndexWorkerMaxResponseBytes)
	if result.err == nil {
		t.Fatal("scanProjectIndexWorkerLine(nil) error = nil, want scanner unavailable error")
	}
	if !strings.Contains(result.err.Error(), "stdout unavailable") {
		t.Fatalf("error = %q, want stdout unavailable", result.err)
	}
}

func TestScanProjectIndexWorkerLineRejectsOversizedResponse(t *testing.T) {
	reader := bufio.NewReader(strings.NewReader(strings.Repeat("x", 32) + "\n"))

	result := scanProjectIndexWorkerLine(reader, 8)

	if result.err == nil {
		t.Fatal("scanProjectIndexWorkerLine error = nil, want oversized response error")
	}
	if !strings.Contains(result.err.Error(), "response exceeded") {
		t.Fatalf("scanProjectIndexWorkerLine error = %v, want response exceeded", result.err)
	}
}

func TestProjectIndexWorker_scanLineUsesCapturedScannerAfterWorkerReset(t *testing.T) {
	reader, writer := io.Pipe()
	defer reader.Close()
	defer writer.Close()

	worker := &ProjectIndexWorker{stdout: bufio.NewReader(reader)}
	capturedStdout := worker.stdout
	resultCh := make(chan projectIndexScanResult, 1)
	go func() {
		resultCh <- scanProjectIndexWorkerLine(capturedStdout, projectIndexWorkerMaxResponseBytes)
	}()

	worker.stdout = nil
	if _, err := writer.Write([]byte(`{"ok":true}` + "\n")); err != nil {
		t.Fatalf("write scanner input: %v", err)
	}

	select {
	case result := <-resultCh:
		if result.err != nil {
			t.Fatalf("scan error = %v, want nil", result.err)
		}
		if got, want := string(result.bytes), `{"ok":true}`; got != want {
			t.Fatalf("scan bytes = %q, want %q", got, want)
		}
	case <-time.After(time.Second):
		t.Fatal("scan timed out")
	}
}

func TestProjectIndexWorker_contextCancellationKillsStuckWorker(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "stuck-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		process.stdin.setEncoding('utf8')
		process.stdin.on('data', (chunk) => {
			const req = JSON.parse(chunk.trim())
			if (req.staticOnly) {
				process.stdout.write(JSON.stringify({
					snapshot: {
						schemaVersion: 1,
						project: { root: req.root, name: req.projectName },
						indexedAt: new Date(0).toISOString(),
						prompts: [],
						contexts: [],
						tools: [],
						definitions: [{ id: 'prompt:static', kind: 'prompt', name: 'static', fidelity: 'partial', status: 'active' }],
						relations: [],
						diagnostics: [{ id: 'diagnostic:static-only', severity: 'warning', code: 'index.static_only', message: 'static fallback' }],
						lintFindings: [],
						sources: []
					}
				}) + '\n')
				return
			}
			// Simulate a TypeScript import graph that never settles.
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := NewProjectIndexWorker(script)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	start := time.Now()
	_, err := worker.IndexProject(ctx, t.TempDir(), "", "fallback-project")
	if err == nil {
		t.Fatal("IndexProject error = nil, want caller deadline exceeded")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("IndexProject error = %v, want caller deadline exceeded", err)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("IndexProject took %s, want bounded cancellation", elapsed)
	}
}

func TestProjectIndexWorker_staticFallbackAfterWorkerCrash(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "crashing-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		process.stdin.setEncoding('utf8')
		process.stdin.once('data', (chunk) => {
			const req = JSON.parse(chunk.trim())
			if (!req.staticOnly) {
				process.exit(134)
				return
			}
			process.stdout.write(JSON.stringify({
				snapshot: {
					schemaVersion: 1,
					project: { root: req.root, name: req.projectName },
					indexedAt: new Date(0).toISOString(),
					prompts: [],
					contexts: [],
					tools: [],
					definitions: [{ id: 'prompt:static-after-crash', kind: 'prompt', name: 'static-after-crash', fidelity: 'partial', status: 'active' }],
					relations: [],
					diagnostics: [{ id: 'diagnostic:static-only', severity: 'warning', code: 'index.static_only', message: 'static fallback' }],
					lintFindings: [],
					sources: []
				}
			}) + '\n')
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := NewProjectIndexWorker(script)
	defer worker.Close()

	index, err := worker.IndexProject(context.Background(), t.TempDir(), "", "crash-fallback")
	if err != nil {
		t.Fatalf("IndexProject error = %v, want static fallback after crash", err)
	}
	if len(index.Definitions) != 1 || index.Definitions[0].ID != "prompt:static-after-crash" {
		t.Fatalf("definitions = %+v, want static fallback definition", index.Definitions)
	}
}

func TestProjectIndexWorker_readsLargeIndexResponse(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "large-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		process.stdin.setEncoding('utf8')
		process.stdin.once('data', (chunk) => {
			const req = JSON.parse(chunk.trim())
			process.stdout.write(JSON.stringify({
				snapshot: {
					schemaVersion: 1,
					project: { root: req.root, name: req.projectName },
					indexedAt: new Date(0).toISOString(),
					prompts: [],
					contexts: [],
					tools: [],
					definitions: [],
					relations: [],
					diagnostics: [{
						id: 'diagnostic:large',
						severity: 'info',
						code: 'index.large_payload',
						message: 'x'.repeat(9 * 1024 * 1024)
					}],
					lintFindings: [],
					sources: []
				}
			}) + '\n')
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := NewProjectIndexWorker(script)
	defer worker.Close()

	index, err := worker.IndexProject(context.Background(), t.TempDir(), "", "large-project")
	if err != nil {
		t.Fatalf("IndexProject error = %v, want large index response", err)
	}
	if len(index.Diagnostics) != 1 || len(index.Diagnostics[0].Message) < 9*1024*1024 {
		t.Fatalf("diagnostics = %+v, want large diagnostic payload", index.Diagnostics)
	}
}

func TestProjectIndexWorker_incrementalRequestRoundTrip(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "incremental-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		process.stdin.setEncoding('utf8')
		process.stdin.once('data', (chunk) => {
			const req = JSON.parse(chunk.trim())
			if (req.method !== 'indexProjectIncremental') {
				process.stdout.write(JSON.stringify({ error: 'unexpected method ' + req.method }) + '\n')
				return
			}
			process.stdout.write(JSON.stringify({
				decision: { kind: 'source-file-reindex' },
				patches: [{
					schemaVersion: 1,
					phase: 'ast',
					project: { root: req.root, name: req.projectName },
					startedAt: new Date(0).toISOString(),
					finishedAt: new Date(0).toISOString(),
					status: 'ok',
					invalidates: { files: req.files, definitionIds: ['prompt:writer'] },
					facts: {
						definitions: [{
							id: 'prompt:writer',
							kind: 'prompt',
							name: req.previousIndex.definitions[0].name,
							fidelity: 'partial',
							status: 'active'
						}]
					}
				}],
				report: {
					planKind: 'source-file-reindex',
					fallbackUsed: false,
					graphConfidence: 'complete-enough-for-source-closure',
					changedFiles: req.files,
					deletedFiles: req.deletedFiles,
					affectedFiles: req.files,
					affectedDefinitionIds: ['prompt:writer'],
					staticParsedFiles: req.files,
					staticCacheHits: 0,
					staticCacheMisses: req.files.length,
					semanticAnalyzedFiles: [],
					semanticCacheHits: 0,
					semanticCacheMisses: 0,
					invalidatedFiles: req.files,
					invalidatedDefinitionIds: ['prompt:writer'],
					durationMsByPhase: {}
				}
			}) + '\n')
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := NewProjectIndexWorker(script)
	defer worker.Close()

	previous := store.IndexData{
		SchemaVersion: 1,
		Definitions: []store.ProjectDefinition{{
			ID:       "prompt:writer",
			Kind:     "prompt",
			Name:     "writer",
			Fidelity: "partial",
			Status:   "active",
		}},
	}
	result, err := worker.IndexProjectIncremental(
		context.Background(),
		t.TempDir(),
		"",
		"incremental-project",
		previous,
		[]string{"src/writer.ts"},
		[]string{"src/old.ts"},
		"ast",
	)
	if err != nil {
		t.Fatalf("IndexProjectIncremental error = %v", err)
	}
	if got, want := result.Report.PlanKind, "source-file-reindex"; got != want {
		t.Fatalf("report planKind = %q, want %q", got, want)
	}
	if len(result.Patches) != 1 || result.Patches[0].Invalidates == nil {
		t.Fatalf("patches = %+v, want one invalidating patch", result.Patches)
	}
	if got, want := result.Patches[0].Invalidates.Files, []string{"src/writer.ts"}; strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("invalidated files = %v, want %v", got, want)
	}
	if len(result.Report.DeletedFiles) != 1 || result.Report.DeletedFiles[0] != "src/old.ts" {
		t.Fatalf("deleted files = %v, want src/old.ts", result.Report.DeletedFiles)
	}
}
