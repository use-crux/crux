package semantic

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestWorker_streamsSemanticSourceProfileRequestBatches(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "semantic-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		import readline from 'node:readline'
		const rl = readline.createInterface({ input: process.stdin, terminal: false })
		const seen = []
		let root = ''
		rl.on('line', (line) => {
			const req = JSON.parse(line)
			seen.push(req.requestKind || 'single')
			if (req.root) root = req.root
			if (req.requestKind !== 'done') return
			if (seen[0] !== 'start' || !seen.includes('sourceProfile:batch')) {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'phase:error',
					transactionId: 'tx-error',
					phase: 'semantic',
					error: { message: 'source profile request was not chunked' }
				}) + '\n')
				return
			}
			const tx = 'tx-semantic'
			process.stdout.write(JSON.stringify({
				protocolVersion: 2,
				type: 'phase:start',
				transactionId: tx,
				phase: 'semantic',
				root,
				startedAt: new Date(0).toISOString()
			}) + '\n')
			process.stdout.write(JSON.stringify({
				protocolVersion: 2,
				type: 'phase:done',
				transactionId: tx,
				phase: 'semantic',
				patch: {
					schemaVersion: 1,
					phase: 'semantic',
					project: { root },
					startedAt: new Date(0).toISOString(),
					finishedAt: new Date(0).toISOString(),
					status: 'ok'
				},
				summary: { factCount: 0 }
			}) + '\n')
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	files := make([]devtools.SemanticSourceProfileFile, 150)
	for i := range files {
		files[i] = devtools.SemanticSourceProfileFile{
			File:        filepath.Join("src", "file.ts"),
			SourceHash:  "hash",
			SourceBytes: 10,
		}
	}
	worker := New(Options{ScriptPath: script})
	defer worker.Close()

	_, err := worker.IndexProjectSemanticPatch(context.Background(), devtools.ProjectSemanticIndexRequest{
		Root:        t.TempDir(),
		ProjectName: "semantic-project",
		Files:       []string{"src/a.ts"},
		Budget:      devtools.IndexPatchBudget{MaxDefinitions: 10},
		SourceProfile: &devtools.SemanticSourceProfile{
			Files:             files,
			DependencyClosure: []string{"src/a.ts"},
			SourceBytes:       1500,
			Complete:          true,
		},
	})
	if err != nil {
		t.Fatalf("IndexProjectSemanticPatch error = %v", err)
	}
}

func TestWorker_streamsPreviousIndexRequestBatches(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "semantic-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		import readline from 'node:readline'
		const rl = readline.createInterface({ input: process.stdin, terminal: false })
		let root = ''
		let definitions = 0
		let sources = 0
		let startWasCompact = false

		rl.on('line', (line) => {
			const req = JSON.parse(line)
			if (req.root) root = req.root
			if (req.requestKind === 'start') {
				const compactDefinitions = !('definitions' in req.previousIndex) ||
					(Array.isArray(req.previousIndex.definitions) && req.previousIndex.definitions.length === 0)
				const compactSources = !('sources' in req.previousIndex) ||
					(Array.isArray(req.previousIndex.sources) && req.previousIndex.sources.length === 0)
				startWasCompact =
					req.previousIndex && compactDefinitions && compactSources
			}
			if (req.requestKind === 'previousIndex:definitions') definitions += req.previousIndexDefinitions.length
			if (req.requestKind === 'previousIndex:sources') sources += req.previousIndexSources.length
			if (req.requestKind !== 'done') return
			if (!startWasCompact || definitions !== 150 || sources !== 129) {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'phase:error',
					transactionId: 'tx-error',
					phase: 'semantic',
					error: { message: 'previous index request was not chunked' }
				}) + '\n')
				return
			}
			const tx = 'tx-semantic'
			process.stdout.write(JSON.stringify({
				protocolVersion: 2,
				type: 'phase:start',
				transactionId: tx,
				phase: 'semantic',
				root,
				startedAt: new Date(0).toISOString()
			}) + '\n')
			process.stdout.write(JSON.stringify({
				protocolVersion: 2,
				type: 'phase:done',
				transactionId: tx,
				phase: 'semantic',
				patch: {
					schemaVersion: 1,
					phase: 'semantic',
					project: { root },
					startedAt: new Date(0).toISOString(),
					finishedAt: new Date(0).toISOString(),
					status: 'ok'
				},
				summary: { factCount: 0 }
			}) + '\n')
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	definitions := make([]store.ProjectDefinition, 150)
	for i := range definitions {
		definitions[i] = store.ProjectDefinition{
			ID:       "prompt:fixture",
			Kind:     "prompt",
			Name:     "fixture",
			Fidelity: "resolved",
		}
	}
	sources := make([]store.IndexSourceFile, 129)
	for i := range sources {
		sources[i] = store.IndexSourceFile{File: filepath.Join("src", "file.ts")}
	}
	previous := store.IndexData{
		SchemaVersion: 1,
		Definitions:   definitions,
		Sources:       sources,
	}

	worker := New(Options{ScriptPath: script})
	defer worker.Close()

	_, err := worker.IndexProjectSemanticPatch(context.Background(), devtools.ProjectSemanticIndexRequest{
		Root:          t.TempDir(),
		ProjectName:   "semantic-project",
		Files:         []string{"src/a.ts"},
		Budget:        devtools.IndexPatchBudget{MaxDefinitions: 10},
		PreviousIndex: &previous,
	})
	if err != nil {
		t.Fatalf("IndexProjectSemanticPatch error = %v", err)
	}
}
