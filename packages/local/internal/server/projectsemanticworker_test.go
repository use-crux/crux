package server

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

func TestProjectSemanticWorker_semanticPatchUsesDedicatedStreamProtocol(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "semantic-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		process.stdin.setEncoding('utf8')
		process.stdin.once('data', (chunk) => {
			const req = JSON.parse(chunk.trim())
			if (req.method !== 'indexProjectSemantic' || req.protocolVersion !== 2) {
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
						producer: { name: '@crux/indexer/project-indexer', version: 'test' },
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
					summary: { factCount: 1 }
				}
			]
			for (const event of events) process.stdout.write(JSON.stringify(event) + '\n')
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := NewProjectSemanticWorker(script)
	defer worker.Close()

	patch, err := worker.IndexProjectSemanticPatch(
		context.Background(),
		devtools.ProjectSemanticIndexRequest{
			Root:        t.TempDir(),
			ProjectName: "semantic-project",
			Budget:      devtools.IndexPatchBudget{MaxDefinitions: 10},
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
}

func TestProjectSemanticWorker_nativeBackendUsesSemanticWorker(t *testing.T) {
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
							producer: { name: '@crux/indexer/project-indexer', version: 'test' },
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

	worker := NewProjectSemanticWorker(script)
	defer worker.Close()

	patch, err := worker.IndexProjectSemanticPatch(
		context.Background(),
		devtools.ProjectSemanticIndexRequest{
			Root:        t.TempDir(),
			ProjectName: "semantic-project",
			Budget:      devtools.IndexPatchBudget{MaxDefinitions: 10},
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

func TestProjectSemanticWorker_reusesProcessAcrossSemanticRequests(t *testing.T) {
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
						producer: { name: '@crux/indexer/project-indexer', version: 'test' },
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

	worker := NewProjectSemanticWorker(script)
	defer worker.Close()

	req := devtools.ProjectSemanticIndexRequest{
		Root:        t.TempDir(),
		ProjectName: "semantic-project",
		Files:       []string{"src/a.ts"},
		Budget:      devtools.IndexPatchBudget{MaxDefinitions: 10},
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
