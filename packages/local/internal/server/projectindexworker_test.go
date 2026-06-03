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
						diagnostics: [{ id: 'diagnostic:static-only', severity: 'warning', code: 'catalog.static_only', message: 'static fallback' }],
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
					diagnostics: [{ id: 'diagnostic:static-only', severity: 'warning', code: 'catalog.static_only', message: 'static fallback' }],
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

	catalog, err := worker.IndexProject(context.Background(), t.TempDir(), "", "crash-fallback")
	if err != nil {
		t.Fatalf("IndexProject error = %v, want static fallback after crash", err)
	}
	if len(catalog.Definitions) != 1 || catalog.Definitions[0].ID != "prompt:static-after-crash" {
		t.Fatalf("definitions = %+v, want static fallback definition", catalog.Definitions)
	}
}

func TestProjectIndexWorker_readsLargeCatalogResponse(t *testing.T) {
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
						code: 'catalog.large_payload',
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

	catalog, err := worker.IndexProject(context.Background(), t.TempDir(), "", "large-project")
	if err != nil {
		t.Fatalf("IndexProject error = %v, want large catalog response", err)
	}
	if len(catalog.Diagnostics) != 1 || len(catalog.Diagnostics[0].Message) < 9*1024*1024 {
		t.Fatalf("diagnostics = %+v, want large diagnostic payload", catalog.Diagnostics)
	}
}
