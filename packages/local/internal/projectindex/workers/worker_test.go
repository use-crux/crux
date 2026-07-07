package workers

import (
	"context"
	"encoding/json"
	"errors"
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

func TestWorker_contextCancellationKillsStuckStreamWorker(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "stuck-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		const holdOpen = setInterval(() => {}, 1000)
		process.stdin.setEncoding('utf8')
		process.stdin.on('data', (chunk) => {
			// Simulate a TypeScript import graph that never settles.
			void chunk
			void holdOpen
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := newTestWorkerWithProjectScript(t, script)
	defer worker.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	start := time.Now()
	_, err := worker.IndexProjectAstFromSyntaxRecordsPatch(
		ctx,
		t.TempDir(),
		"",
		"stuck-project",
		[]json.RawMessage{json.RawMessage(`{"kind":"source","sourceFile":"src/writer.ts"}`)},
	)
	if err == nil {
		t.Fatal("IndexProjectAstPatch error = nil, want caller deadline exceeded")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("IndexProjectAstPatch error = %v, want caller deadline exceeded", err)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("IndexProjectAstPatch took %s, want bounded cancellation", elapsed)
	}
}

func TestWorker_sourceOnlyFallbackAfterOversizedResponse(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "oversized-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		function configArtifact(req, status, diagnostics) {
			return {
				protocolVersion: 2,
				type: 'artifact:done',
				transactionId: 'artifact-project-config',
				artifact: 'projectConfig',
				root: req.root,
				payload: {
					root: req.root,
					configFile: { status, origin: 'discovered' },
					quality: {
						id: { value: 'none', origin: 'none' },
						dir: { value: '.crux/quality', origin: 'default' },
						include: { values: [], origin: 'default' },
						exclude: { values: [], origin: 'default' },
						redact: { values: [], origin: 'default' },
						trials: { value: '1', origin: 'default' },
						concurrency: { value: '5', origin: 'default' },
						timeoutMs: { value: '60000', origin: 'default' },
						replay: { value: 'live', origin: 'default' }
					},
					generation: {
						autoEscape: { value: 'true', origin: 'default' },
						securityWarnings: { value: 'true', origin: 'default' },
						tokenizer: { value: 'none', origin: 'none' },
						middleware: { value: 'none', origin: 'none' }
					},
					indexer: { trust: { value: 'first-party-only', origin: 'default' }, extensions: { values: [], origin: 'default' } },
					observability: {
						enabled: { value: 'true', origin: 'default' },
						serverUrl: { value: 'none', origin: 'none' },
						transport: { value: 'none', origin: 'none' }
					},
					devtools: {
						serverUrl: { value: 'none', origin: 'none' },
						bridge: { value: 'none', origin: 'none' }
					},
					persistence: { store: { value: 'none', origin: 'none' } },
					lint: {
						profile: { value: 'recommended', origin: 'default' },
						rules: { value: '0', origin: 'default' }
					},
					plugins: { values: [], origin: 'default' },
					discovered: { definitions: 0, relations: 0, evaluations: 0, definitionKinds: {} },
					diagnostics
				}
			}
		}
		process.stdin.setEncoding('utf8')
		process.stdin.once('data', (chunk) => {
			const req = JSON.parse(chunk.trim())
			if (req.resolutionMode === 'source-only') {
				process.stdout.write(JSON.stringify(configArtifact(req, 'source-only', [
					{ severity: 'warning', code: 'index.source_only', message: 'source-only fallback' }
				])) + '\n')
				return
			}
			process.stdout.write(JSON.stringify(configArtifact(req, 'loaded', [
				{ severity: 'warning', code: 'index.huge', message: 'x'.repeat(20 * 1024 * 1024) }
			])) + '\n')
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := newTestWorkerWithProjectScript(t, script)
	defer worker.Close()

	config, err := worker.InspectProjectConfig(context.Background(), t.TempDir(), "", "oversized-fallback")
	if err != nil {
		t.Fatalf("InspectProjectConfig error = %v, want source-only fallback after oversized response", err)
	}
	if !strings.Contains(string(config), `"source-only"`) {
		t.Fatalf("project config response = %s, want source-only fallback config", config)
	}
}

func TestWorker_inspectProjectConfigFallsBackToSourceOnlyAfterWorkerCrash(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "inspect-fallback-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		process.stdin.setEncoding('utf8')
		process.stdin.once('data', (chunk) => {
			const req = JSON.parse(chunk.trim())
			if (req.method !== 'inspectProjectConfig' || req.protocolVersion !== 2) {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'artifact:error',
					transactionId: 'artifact-error',
					artifact: 'projectConfig',
					error: { message: 'expected V2 inspectProjectConfig request' }
				}) + '\n')
				return
			}
			if (req.resolutionMode !== 'source-only') {
				process.exit(134)
				return
			}
			process.stdout.write(JSON.stringify({
				protocolVersion: 2,
				type: 'artifact:done',
				transactionId: 'artifact-project-config',
				artifact: 'projectConfig',
				root: req.root,
				payload: {
					root: req.root,
					configFile: { status: 'source-only', origin: 'discovered' },
					quality: {
						id: { value: 'none', origin: 'none' },
						dir: { value: '.crux/quality', origin: 'default' },
						include: { values: [], origin: 'default' },
						exclude: { values: [], origin: 'default' },
						redact: { values: [], origin: 'default' },
						trials: { value: '1', origin: 'default' },
						concurrency: { value: '5', origin: 'default' },
						timeoutMs: { value: '60000', origin: 'default' },
						replay: { value: 'live', origin: 'default' }
					},
					generation: {
						autoEscape: { value: 'true', origin: 'default' },
						securityWarnings: { value: 'true', origin: 'default' },
						tokenizer: { value: 'none', origin: 'none' },
						middleware: { value: 'none', origin: 'none' }
					},
					indexer: { trust: { value: 'first-party-only', origin: 'default' }, extensions: { values: [], origin: 'default' } },
					observability: {
						enabled: { value: 'true', origin: 'default' },
						serverUrl: { value: 'none', origin: 'none' },
						transport: { value: 'none', origin: 'none' }
					},
					devtools: {
						serverUrl: { value: 'none', origin: 'none' },
						bridge: { value: 'none', origin: 'none' }
					},
					persistence: { store: { value: 'none', origin: 'none' } },
					lint: {
						profile: { value: 'recommended', origin: 'default' },
						rules: { value: '0', origin: 'default' }
					},
					plugins: { values: [], origin: 'default' },
					discovered: { definitions: 0, relations: 0, evaluations: 0, definitionKinds: {} },
					diagnostics: [{ severity: 'warning', code: 'index.source_only', message: 'source-only fallback' }]
				}
			}) + '\n')
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := newTestWorkerWithProjectScript(t, script)
	defer worker.Close()

	config, err := worker.InspectProjectConfig(context.Background(), t.TempDir(), "", "inspect-fallback")
	if err != nil {
		t.Fatalf("InspectProjectConfig error = %v, want source-only fallback after crash", err)
	}
	if !strings.Contains(string(config), `"source-only"`) {
		t.Fatalf("project config response = %s, want source-only fallback config", config)
	}
}
