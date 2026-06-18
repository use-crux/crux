package server

import (
	"context"
	"errors"
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
			if (req.resolutionMode === 'source-only') {
				process.stdout.write(JSON.stringify({
					snapshot: {
						schemaVersion: 1,
						project: { root: req.root, name: req.projectName },
						indexedAt: new Date(0).toISOString(),
						prompts: [],
						contexts: [],
						tools: [],
						definitions: [{ id: 'prompt:source-only', kind: 'prompt', name: 'source-only', fidelity: 'partial', status: 'active' }],
						relations: [],
						diagnostics: [{ id: 'diagnostic:source-only', severity: 'warning', code: 'index.source_only', message: 'source-only fallback' }],
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

func TestProjectIndexWorker_sourceOnlyFallbackAfterWorkerCrash(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "crashing-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		process.stdin.setEncoding('utf8')
		process.stdin.once('data', (chunk) => {
			const req = JSON.parse(chunk.trim())
			if (req.resolutionMode !== 'source-only') {
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
					definitions: [{ id: 'prompt:source-only-after-crash', kind: 'prompt', name: 'source-only-after-crash', fidelity: 'partial', status: 'active' }],
					relations: [],
					diagnostics: [{ id: 'diagnostic:source-only', severity: 'warning', code: 'index.source_only', message: 'source-only fallback' }],
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
		t.Fatalf("IndexProject error = %v, want source-only fallback after crash", err)
	}
	if len(index.Definitions) != 1 || index.Definitions[0].ID != "prompt:source-only-after-crash" {
		t.Fatalf("definitions = %+v, want source-only fallback definition", index.Definitions)
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

func TestProjectIndexWorker_resolveProjectModelUsesConfigPolicyRequest(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "project-model-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		process.stdin.setEncoding('utf8')
		process.stdin.once('data', (chunk) => {
			const req = JSON.parse(chunk.trim())
			if (req.method !== 'resolveProjectModel') {
				process.stdout.write(JSON.stringify({ error: 'unexpected method ' + req.method }) + '\n')
				return
			}
			if (req.staticOnly !== undefined) {
				process.stdout.write(JSON.stringify({ error: 'resolveProjectModel must not send staticOnly' }) + '\n')
				return
			}
			if (req.resolutionMode !== 'config-policy') {
				process.stdout.write(JSON.stringify({ error: 'resolveProjectModel must use config-policy, got ' + req.resolutionMode }) + '\n')
				return
			}
			process.stdout.write(JSON.stringify({
				projectModel: {
					root: { value: req.root, provenance: { kind: 'filesystem', path: req.root, convention: 'resolved project root' } },
					resolutionMode: { value: req.resolutionMode, provenance: { kind: 'runtime', attribute: 'project-model.resolutionMode' } },
					configFiles: [],
					sourceRoots: [],
					ignoredPaths: [],
					definitions: [],
					relations: [],
					quality: {
						persistenceRoot: { value: req.root + '/.crux/quality', provenance: { kind: 'filesystem', path: req.root, convention: 'default quality persistence root' } },
						includeGlobs: [],
						excludeGlobs: [],
						evaluationFiles: []
					},
					diagnostics: []
				}
			}) + '\n')
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := NewProjectIndexWorker(script)
	defer worker.Close()

	model, err := worker.ResolveProjectModel(context.Background(), t.TempDir(), "", "inspect-project")
	if err != nil {
		t.Fatalf("ResolveProjectModel error = %v, want config-policy request success", err)
	}
	if !strings.Contains(string(model), `"root"`) {
		t.Fatalf("project model response = %s, want JSON project model", model)
	}
}

func TestProjectIndexWorker_sourceOnlyFallbackAfterOversizedResponse(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "oversized-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		process.stdin.setEncoding('utf8')
		process.stdin.once('data', (chunk) => {
			const req = JSON.parse(chunk.trim())
			if (req.resolutionMode === 'source-only') {
				process.stdout.write(JSON.stringify({
					snapshot: {
						schemaVersion: 1,
						project: { root: req.root, name: req.projectName },
						indexedAt: new Date(0).toISOString(),
						prompts: [],
						contexts: [],
						tools: [],
						definitions: [{ id: 'prompt:source-only-after-oversize', kind: 'prompt', name: 'source-only-after-oversize', fidelity: 'partial', status: 'active' }],
						relations: [],
						diagnostics: [{ id: 'diagnostic:source-only', severity: 'warning', code: 'index.source_only', message: 'source-only fallback' }],
						lintFindings: [],
						sources: []
					}
				}) + '\n')
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
					definitions: [],
					relations: [],
					diagnostics: [{ id: 'diagnostic:huge', severity: 'warning', code: 'index.huge', message: 'x'.repeat(20 * 1024 * 1024) }],
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

	index, err := worker.IndexProject(context.Background(), t.TempDir(), "", "oversized-fallback")
	if err != nil {
		t.Fatalf("IndexProject error = %v, want source-only fallback after oversized response", err)
	}
	if len(index.Definitions) != 1 || index.Definitions[0].ID != "prompt:source-only-after-oversize" {
		t.Fatalf("definitions = %+v, want source-only fallback definition", index.Definitions)
	}
}

func TestProjectIndexWorker_inspectProjectConfigFallsBackToSourceOnlyAfterWorkerCrash(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "inspect-fallback-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		process.stdin.setEncoding('utf8')
		process.stdin.once('data', (chunk) => {
			const req = JSON.parse(chunk.trim())
			if (req.method !== 'inspectProjectConfig') {
				process.stdout.write(JSON.stringify({ error: 'unexpected method ' + req.method }) + '\n')
				return
			}
			if (req.resolutionMode !== 'source-only') {
				process.exit(134)
				return
			}
			process.stdout.write(JSON.stringify({
				config: {
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

	worker := NewProjectIndexWorker(script)
	defer worker.Close()

	config, err := worker.InspectProjectConfig(context.Background(), t.TempDir(), "", "inspect-fallback")
	if err != nil {
		t.Fatalf("InspectProjectConfig error = %v, want source-only fallback after crash", err)
	}
	if !strings.Contains(string(config), `"source-only"`) {
		t.Fatalf("project config response = %s, want source-only fallback config", config)
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
