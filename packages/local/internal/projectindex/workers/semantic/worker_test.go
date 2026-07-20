package semantic

import (
	"context"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestWorker_semanticPatchUsesDedicatedStreamProtocol(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "semantic-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		process.stdin.setEncoding('utf8')
		process.stdin.once('data', (chunk) => {
			const req = JSON.parse(chunk.trim())
			if (req.method !== 'indexProjectSemantic' || req.protocolVersion !== 2 || req.cacheDisabled !== true) {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'phase:error',
					transactionId: 'tx-error',
					phase: 'semantic',
					error: { message: 'expected streamed indexProjectSemantic request' }
				}) + '\n')
				return
			}
			const events = [
				{
					protocolVersion: 2,
					type: 'phase:start',
					transactionId: 'tx-semantic',
					phase: 'semantic',
					root: req.root,
					startedAt: new Date(0).toISOString()
				},
				{
					protocolVersion: 2,
					type: 'fact:batch',
					transactionId: 'tx-semantic',
					sequence: 0,
					facts: [{
						schemaVersion: 1,
						factId: 'definitions:prompt:semantic',
						kind: 'definitions',
						phase: 'semantic',
						projectRoot: req.root,
						producer: { name: '@use-crux/indexer/project-indexer', version: 'test' },
						fidelity: 'inferred',
						provenance: { kind: 'runtime', attribute: 'project-index.semantic' },
						fact: { id: 'prompt:semantic', kind: 'prompt', name: 'semantic', fidelity: 'resolved', status: 'active' }
					}]
				},
				{
					protocolVersion: 2,
					type: 'phase:done',
					transactionId: 'tx-semantic',
					phase: 'semantic',
					patch: {
						schemaVersion: 1,
						phase: 'semantic',
						project: { root: req.root, name: req.projectName },
						startedAt: new Date(0).toISOString(),
						finishedAt: new Date(0).toISOString(),
						status: 'ok'
					},
					summary: {
						factCount: 1,
						timings: [{ name: 'semantic.cache.hit', durationMs: 0, count: 1 }]
					}
				}
			]
			for (const event of events) process.stdout.write(JSON.stringify(event) + '\n')
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := New(Options{ScriptPath: script})
	defer worker.Close()

	patch, err := worker.IndexProjectSemanticPatch(
		projectindex.WithoutCache(context.Background()),
		projectindex.ProjectSemanticIndexRequest{
			Root:        t.TempDir(),
			ProjectName: "semantic-project",
			Budget:      projectindex.IndexPatchBudget{MaxDefinitions: 10},
		},
	)
	if err != nil {
		t.Fatalf("IndexProjectSemanticPatch error = %v", err)
	}
	if patch.Phase != "semantic" {
		t.Fatalf("patch phase = %q, want semantic", patch.Phase)
	}
	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:semantic" {
		t.Fatalf("definitions = %+v, want streamed semantic definition", patch.Facts.Definitions)
	}
	timings := worker.LastSemanticTimings()
	if len(timings) != 1 || timings[0].Name != "semantic.cache.hit" || timings[0].Count != 1 {
		t.Fatalf("semantic timings = %+v, want semantic cache hit timing", timings)
	}
}

func TestWorker_nativeBackendUsesSemanticWorker(t *testing.T) {
	t.Setenv("CRUX_INDEX_SEMANTIC_BACKEND", "native")
	t.Setenv("CRUX_INDEX_NATIVE_ENGINE", "tsgo")

	dir := t.TempDir()
	script := filepath.Join(dir, "semantic-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
			process.stdin.setEncoding('utf8')
			process.stdin.once('data', (chunk) => {
				const req = JSON.parse(chunk.trim())
				if (req.method !== 'indexProjectSemantic') throw new Error('unexpected method ' + req.method)
				const events = [
					{
						protocolVersion: 2,
						type: 'phase:start',
						transactionId: 'tx-semantic',
						phase: 'semantic',
						root: req.root,
						startedAt: new Date(0).toISOString()
					},
					{
						protocolVersion: 2,
						type: 'fact:batch',
						transactionId: 'tx-semantic',
						sequence: 0,
						facts: [{
							schemaVersion: 1,
							factId: 'definitions:prompt:native',
							kind: 'definitions',
							phase: 'semantic',
							projectRoot: req.root,
							producer: { name: '@use-crux/indexer/project-indexer', version: 'test' },
							fidelity: 'inferred',
							provenance: { kind: 'runtime', attribute: 'project-index.semantic' },
							fact: { id: 'prompt:native', kind: 'prompt', name: 'native', fidelity: 'resolved', status: 'active' }
						}]
					},
					{
						protocolVersion: 2,
						type: 'phase:done',
						transactionId: 'tx-semantic',
						phase: 'semantic',
						patch: {
							schemaVersion: 1,
							phase: 'semantic',
							project: { root: req.root, name: req.projectName },
							startedAt: new Date(0).toISOString(),
							finishedAt: new Date(0).toISOString(),
							status: 'ok'
						},
						summary: { factCount: 1 }
					}
				]
				for (const event of events) process.stdout.write(JSON.stringify(event) + '\n')
			})
		`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := New(Options{ScriptPath: script})
	defer worker.Close()

	patch, err := worker.IndexProjectSemanticPatch(
		context.Background(),
		projectindex.ProjectSemanticIndexRequest{
			Root:        t.TempDir(),
			ProjectName: "semantic-project",
			Budget:      projectindex.IndexPatchBudget{MaxDefinitions: 10},
		},
	)
	if err != nil {
		t.Fatalf("IndexProjectSemanticPatch error = %v", err)
	}
	if patch.Status != "ok" {
		t.Fatalf("patch status = %q, want ok", patch.Status)
	}
	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:native" {
		t.Fatalf("definitions = %+v, want semantic worker output", patch.Facts.Definitions)
	}
}

func TestWorker_reusesProcessAcrossSemanticRequests(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "semantic-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		process.stdin.setEncoding('utf8')
		let buffer = ''
		let calls = 0

		process.stdin.on('data', (chunk) => {
			buffer += chunk
			for (;;) {
				const newline = buffer.indexOf('\n')
				if (newline < 0) return
				const line = buffer.slice(0, newline).trim()
				buffer = buffer.slice(newline + 1)
				if (line.length > 0) handle(JSON.parse(line))
			}
		})

		function handle(req) {
			calls += 1
			const id = 'prompt:call-' + calls
			const tx = 'tx-semantic-' + calls
			if (!Array.isArray(req.files) || req.files[0] !== 'src/a.ts') {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'phase:error',
					transactionId: tx,
					phase: 'semantic',
					error: { message: 'expected scoped files' }
				}) + '\n')
				return
			}
			const events = [
				{
					protocolVersion: 2,
					type: 'phase:start',
					transactionId: tx,
					phase: 'semantic',
					root: req.root,
					startedAt: new Date(0).toISOString()
				},
				{
					protocolVersion: 2,
					type: 'fact:batch',
					transactionId: tx,
					sequence: 0,
					facts: [{
						schemaVersion: 1,
						factId: 'definitions:' + id,
						kind: 'definitions',
						phase: 'semantic',
						projectRoot: req.root,
						producer: { name: '@use-crux/indexer/project-indexer', version: 'test' },
						fidelity: 'inferred',
						provenance: { kind: 'runtime', attribute: 'project-index.semantic' },
						fact: { id, kind: 'prompt', name: id, fidelity: 'resolved', status: 'active' }
					}]
				},
				{
					protocolVersion: 2,
					type: 'phase:done',
					transactionId: tx,
					phase: 'semantic',
					patch: {
						schemaVersion: 1,
						phase: 'semantic',
						project: { root: req.root, name: req.projectName },
						startedAt: new Date(0).toISOString(),
						finishedAt: new Date(0).toISOString(),
						status: 'ok'
					},
					summary: { factCount: 1 }
				}
			]
			for (const event of events) process.stdout.write(JSON.stringify(event) + '\n')
		}
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := New(Options{ScriptPath: script})
	defer worker.Close()

	req := projectindex.ProjectSemanticIndexRequest{
		Root:        t.TempDir(),
		ProjectName: "semantic-project",
		Files:       []string{"src/a.ts"},
		Budget:      projectindex.IndexPatchBudget{MaxDefinitions: 10},
	}
	if _, err := worker.IndexProjectSemanticPatch(context.Background(), req); err != nil {
		t.Fatalf("first IndexProjectSemanticPatch error = %v", err)
	}
	patch, err := worker.IndexProjectSemanticPatch(context.Background(), req)
	if err != nil {
		t.Fatalf("second IndexProjectSemanticPatch error = %v", err)
	}
	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:call-2" {
		t.Fatalf("definitions = %+v, want second request from same worker process", patch.Facts.Definitions)
	}
}

func TestWorker_shardsSemanticRequestsAcrossWorkerPool(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	marker := filepath.Join(dir, "started.txt")
	t.Setenv("CRUX_TEST_SEMANTIC_MARKER", marker)

	script := filepath.Join(dir, "semantic-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		import { appendFileSync, readFileSync } from 'node:fs'
		import { basename } from 'node:path'

		process.stdin.setEncoding('utf8')
		let buffer = ''
		const pending = new Map()
		const marker = process.env.CRUX_TEST_SEMANTIC_MARKER

		process.stdin.on('data', (chunk) => {
			buffer += chunk
			for (;;) {
				const newline = buffer.indexOf('\n')
				if (newline < 0) return
				const line = buffer.slice(0, newline).trim()
				buffer = buffer.slice(newline + 1)
				if (line.length > 0) {
					const req = assemble(JSON.parse(line))
					if (req) void handle(req)
				}
			}
		})

		function assemble(req) {
			if (!req.requestKind) return req
			if (req.requestKind === 'start') {
				pending.set(req.requestId, {
					...req,
					requestKind: undefined,
					previousIndex: req.previousIndex ? { ...req.previousIndex, definitions: [], sources: [] } : undefined,
					sourceProfile: req.sourceProfile ? { ...req.sourceProfile, files: [] } : undefined,
				})
				return undefined
			}
			const current = pending.get(req.requestId)
			if (!current) throw new Error('missing pending request ' + req.requestId)
			if (req.requestKind === 'previousIndex:definitions') {
				current.previousIndex.definitions.push(...(req.previousIndexDefinitions ?? []))
				return undefined
			}
			if (req.requestKind === 'previousIndex:sources') {
				current.previousIndex.sources.push(...(req.previousIndexSources ?? []))
				return undefined
			}
			if (req.requestKind === 'sourceProfile:batch') {
				current.sourceProfile.files.push(...(req.sourceProfileFiles ?? []))
				return undefined
			}
			if (req.requestKind === 'done') {
				pending.delete(req.requestId)
				return current
			}
		}

		async function handle(req) {
			if (!Array.isArray(req.files) || req.files.length !== 1) {
				throw new Error('expected one file per semantic shard, got ' + JSON.stringify(req.files))
			}
			appendFileSync(marker, req.files[0] + '\n')
			await waitForBothShards()
			const name = basename(req.files[0]).replace(/\.[^.]+$/, '')
			const id = 'prompt:' + name
			const tx = 'tx-' + name
			const events = [
				{
					protocolVersion: 2,
					type: 'phase:start',
					transactionId: tx,
					phase: 'semantic',
					root: req.root,
					startedAt: new Date(0).toISOString()
				},
				{
					protocolVersion: 2,
					type: 'fact:batch',
					transactionId: tx,
					sequence: 0,
					facts: [{
						schemaVersion: 1,
						factId: 'definitions:' + id,
						kind: 'definitions',
						phase: 'semantic',
						projectRoot: req.root,
						producer: { name: '@use-crux/indexer/project-indexer', version: 'test' },
						fidelity: 'inferred',
						provenance: { kind: 'runtime', attribute: 'project-index.semantic' },
						fact: { id, kind: 'prompt', name, fidelity: 'resolved', status: 'active' }
					}]
				},
				{
					protocolVersion: 2,
					type: 'phase:done',
					transactionId: tx,
					phase: 'semantic',
					patch: {
						schemaVersion: 1,
						phase: 'semantic',
						project: { root: req.root, name: req.projectName },
						startedAt: new Date(0).toISOString(),
						finishedAt: new Date(0).toISOString(),
						status: 'ok'
					},
					summary: { factCount: 1, timings: [{ name: 'semantic.program.create', durationMs: 5, count: 1 }] }
				}
			]
			for (const event of events) process.stdout.write(JSON.stringify(event) + '\n')
		}

		async function waitForBothShards() {
			const deadline = Date.now() + 2500
			while (Date.now() < deadline) {
				try {
					const lines = readFileSync(marker, 'utf8').trim().split('\n').filter(Boolean)
					if (lines.length >= 2) return
				} catch {}
				await new Promise((resolve) => setTimeout(resolve, 10))
			}
			throw new Error('timed out waiting for both semantic shards')
		}
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	root := t.TempDir()
	app := filepath.Join(root, "packages", "app", "src", "app.ts")
	lib := filepath.Join(root, "packages", "lib", "src", "lib.ts")
	req := projectindex.ProjectSemanticIndexRequest{
		Root:        root,
		ProjectName: "semantic-project",
		Files:       []string{app, lib},
		Budget:      projectindex.IndexPatchBudget{MaxDefinitions: 10},
		PreviousIndex: &store.IndexData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: root, Name: "semantic-project"},
			SourceGraph: &store.ProjectIndexSourceGraph{
				SchemaVersion: 1,
				ProducedBy:    "@use-crux/indexer",
				Capabilities:  []string{"source-dependencies", "project-shards"},
				Shards: []store.ProjectIndexShard{
					{ID: "packages/app", Root: filepath.Join(root, "packages", "app")},
					{ID: "packages/lib", Root: filepath.Join(root, "packages", "lib")},
				},
			},
			Sources: []store.IndexSourceFile{
				{File: app, Status: "indexed", ShardID: "packages/app"},
				{File: lib, Status: "indexed", ShardID: "packages/lib"},
			},
		},
		SourceProfile: &projectindex.SemanticSourceProfile{
			Files: []projectindex.SemanticSourceProfileFile{
				{File: app, SourceHash: "hash-app", SourceBytes: 10},
				{File: lib, SourceHash: "hash-lib", SourceBytes: 10},
			},
			DependencyClosure: []string{app, lib},
			SourceBytes:       20,
			Complete:          true,
		},
	}

	worker := New(Options{ScriptPath: script, MaxWorkers: 2})
	defer worker.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	patch, err := worker.IndexProjectSemanticPatch(ctx, req)
	if err != nil {
		t.Fatalf("IndexProjectSemanticPatch error = %v", err)
	}

	ids := []string{}
	for _, definition := range patch.Facts.Definitions {
		ids = append(ids, definition.ID)
	}
	slices.Sort(ids)
	if !slices.Equal(ids, []string{"prompt:app", "prompt:lib"}) {
		t.Fatalf("definitions = %v, want sharded app/lib definitions", ids)
	}
	started := strings.Fields(string(mustReadFile(t, marker)))
	slices.Sort(started)
	if !slices.Equal(started, []string{app, lib}) {
		t.Fatalf("started shard files = %v, want %v", started, []string{app, lib})
	}
	timings := worker.LastSemanticTimings()
	if len(timings) != 1 || timings[0].Name != "semantic.program.create" || timings[0].Count != 2 {
		t.Fatalf("semantic timings = %+v, want merged program timing count 2", timings)
	}
}

func mustReadFile(t testing.TB, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return data
}
