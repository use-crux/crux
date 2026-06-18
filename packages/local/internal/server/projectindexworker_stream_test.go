package server

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestProjectIndexWorker_astPatchUsesStreamProtocol(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "stream-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		process.stdin.setEncoding('utf8')
		process.stdin.once('data', (chunk) => {
			const req = JSON.parse(chunk.trim())
			if (req.method !== 'indexProjectAst' || req.protocolVersion !== 2) {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'phase:error',
					transactionId: 'tx-error',
					phase: 'ast',
					error: { message: 'expected streamed indexProjectAst request' }
				}) + '\n')
				return
			}
			const events = [
				{
					protocolVersion: 2,
					type: 'phase:start',
					transactionId: 'tx-ast',
					phase: 'ast',
					root: req.root,
					startedAt: new Date(0).toISOString()
				},
				{
					protocolVersion: 2,
					type: 'fact:batch',
					transactionId: 'tx-ast',
					sequence: 0,
					facts: [{
						schemaVersion: 1,
						factId: 'definitions:prompt:streamed',
						kind: 'definitions',
						phase: 'ast',
						projectRoot: req.root,
						producer: { name: '@crux/indexer/project-indexer', version: 'test' },
						fact: { id: 'prompt:streamed', kind: 'prompt', name: 'streamed', fidelity: 'partial', status: 'active' }
					}]
				},
				{
					protocolVersion: 2,
					type: 'phase:done',
					transactionId: 'tx-ast',
					phase: 'ast',
					patch: {
						schemaVersion: 1,
						phase: 'ast',
						project: { root: req.root, name: req.projectName },
						startedAt: new Date(0).toISOString(),
						finishedAt: new Date(0).toISOString(),
						status: 'ok',
						invalidates: { all: true }
					},
					summary: { factCount: 1 }
				}
			]
			for (const event of events) process.stdout.write(JSON.stringify(event) + '\n')
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := NewProjectIndexWorker(script)
	defer worker.Close()

	patch, err := worker.IndexProjectAstPatch(context.Background(), t.TempDir(), "", "stream-project")
	if err != nil {
		t.Fatalf("IndexProjectAstPatch error = %v", err)
	}
	if patch.Phase != "ast" {
		t.Fatalf("patch phase = %q, want ast", patch.Phase)
	}
	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:streamed" {
		t.Fatalf("definitions = %+v, want streamed definition", patch.Facts.Definitions)
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
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'phase:error',
					transactionId: 'tx-error',
					phase: 'ast',
					error: { message: 'unexpected method ' + req.method }
				}) + '\n')
				return
			}
			if (req.protocolVersion !== 2) {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'phase:error',
					transactionId: 'tx-error',
					phase: 'ast',
					error: { message: 'expected protocolVersion 2' }
				}) + '\n')
				return
			}
			const report = {
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
			const events = [
				{
					protocolVersion: 2,
					type: 'phase:start',
					transactionId: 'tx-incremental-ast',
					phase: 'ast',
					root: req.root,
					startedAt: new Date(0).toISOString()
				},
				{
					protocolVersion: 2,
					type: 'fact:batch',
					transactionId: 'tx-incremental-ast',
					sequence: 0,
					facts: [{
						schemaVersion: 1,
						factId: 'definitions:prompt:writer',
						kind: 'definitions',
						phase: 'ast',
						projectRoot: req.root,
						producer: { name: '@crux/indexer/project-indexer', version: 'test' },
						fact: {
							id: 'prompt:writer',
							kind: 'prompt',
							name: req.previousIndex.definitions[0].name,
							fidelity: 'partial',
							status: 'active'
						}
					}]
				},
				{
					protocolVersion: 2,
					type: 'phase:done',
					transactionId: 'tx-incremental-ast',
					phase: 'ast',
					patch: {
						schemaVersion: 1,
						phase: 'ast',
						project: { root: req.root, name: req.projectName },
						startedAt: new Date(0).toISOString(),
						finishedAt: new Date(0).toISOString(),
						status: 'ok',
						invalidates: { files: req.files, definitionIds: ['prompt:writer'] }
					},
					summary: {
						factCount: 1,
						decision: { kind: 'source-file-reindex' },
						report
					}
				}
			]
			for (const event of events) process.stdout.write(JSON.stringify(event) + '\n')
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
