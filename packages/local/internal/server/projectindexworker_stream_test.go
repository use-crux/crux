package server

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestProjectIndexWorker_streamsIncrementalPreviousIndexRequestBatches(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "project-indexer.mjs")
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
					req.method === 'indexProjectIncremental' &&
					req.previousIndex &&
					compactDefinitions &&
					compactSources
			}
			if (req.requestKind === 'previousIndex:definitions') definitions += req.previousIndexDefinitions.length
			if (req.requestKind === 'previousIndex:sources') sources += req.previousIndexSources.length
			if (req.requestKind !== 'done') return
			if (!startWasCompact || definitions !== 150 || sources !== 129) {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'phase:error',
					transactionId: 'tx-error',
					phase: 'ast',
					error: { message: 'incremental previous index request was not chunked' }
				}) + '\n')
				return
			}
			const tx = 'tx-ast'
			process.stdout.write(JSON.stringify({
				protocolVersion: 2,
				type: 'phase:start',
				transactionId: tx,
				phase: 'ast',
				root,
				startedAt: new Date(0).toISOString()
			}) + '\n')
			process.stdout.write(JSON.stringify({
				protocolVersion: 2,
				type: 'phase:done',
				transactionId: tx,
				phase: 'ast',
				patch: {
					schemaVersion: 1,
					phase: 'ast',
					project: { root },
					startedAt: new Date(0).toISOString(),
					finishedAt: new Date(0).toISOString(),
					status: 'ok'
				},
				summary: {
					factCount: 0,
					decision: { kind: 'source-file-reindex' },
					report: {
						planKind: 'source-file-reindex',
						fallbackUsed: false,
						graphConfidence: 'complete-enough-for-source-closure',
						changedFiles: [],
						deletedFiles: [],
						affectedFiles: [],
						affectedDefinitionIds: [],
						staticParsedFiles: [],
						staticCacheHits: 0,
						staticCacheMisses: 0,
						semanticAnalyzedFiles: [],
						semanticCacheHits: 0,
						semanticCacheMisses: 0,
						invalidatedFiles: [],
						invalidatedDefinitionIds: [],
						durationMsByPhase: {},
						patchCounts: { ast: 1, semantic: 0, total: 1 },
						sourceProfileFileCount: 0,
						semanticStatus: 'not-requested'
					}
				}
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

	worker := NewProjectIndexWorker(script)
	defer worker.Close()

	result, err := worker.IndexProjectIncremental(context.Background(), t.TempDir(), "", "project", previous, []string{"src/a.ts"}, nil, "ast")
	if err != nil {
		t.Fatalf("IndexProjectIncremental error = %v", err)
	}
	if result.Report.PlanKind != "source-file-reindex" || len(result.Patches) != 1 {
		t.Fatalf("result = %+v, want one streamed incremental patch", result)
	}
}
