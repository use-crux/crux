package server

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestProjectIndexWorker_resolveProjectModelUsesArtifactStreamProtocol(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "project-model-artifact-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		process.stdin.setEncoding('utf8')
		process.stdin.once('data', (chunk) => {
			const req = JSON.parse(chunk.trim())
			if (req.method !== 'resolveProjectModel' || req.protocolVersion !== 2) {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'artifact:error',
					transactionId: 'artifact-error',
					artifact: 'projectModel',
					error: { message: 'expected V2 resolveProjectModel request' }
				}) + '\n')
				return
			}
			if (req.staticOnly !== undefined) {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'artifact:error',
					transactionId: 'artifact-error',
					artifact: 'projectModel',
					error: { message: 'resolveProjectModel must not send staticOnly' }
				}) + '\n')
				return
			}
			if (req.resolutionMode !== 'config-policy') {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'artifact:error',
					transactionId: 'artifact-error',
					artifact: 'projectModel',
					error: { message: 'resolveProjectModel must use config-policy, got ' + req.resolutionMode }
				}) + '\n')
				return
			}
			process.stdout.write(JSON.stringify({
				protocolVersion: 2,
				type: 'artifact:done',
				transactionId: 'artifact-project-model',
				artifact: 'projectModel',
				root: req.root,
				payload: {
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
		t.Fatalf("ResolveProjectModel error = %v, want artifact stream success", err)
	}
	if !strings.Contains(string(model), `"resolutionMode"`) {
		t.Fatalf("project model response = %s, want JSON project model", model)
	}
}

func TestProjectIndexWorker_corruptAstStreamDoesNotUpdateServiceStore(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	root := t.TempDir()
	dir := t.TempDir()
	script := filepath.Join(dir, "corrupt-stream-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		process.stdin.setEncoding('utf8')
		process.stdin.once('data', (chunk) => {
			const req = JSON.parse(chunk.trim())
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
						factId: 'definitions:prompt:corrupt',
						kind: 'definitions',
						phase: 'ast',
						projectRoot: req.root,
						producer: { name: '@crux/indexer/project-indexer', version: 'test' },
						fact: { id: 'prompt:corrupt', kind: 'prompt', name: 'corrupt', fidelity: 'partial', status: 'active' }
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
					summary: { factCount: 0 }
				}
			]
			for (const event of events) process.stdout.write(JSON.stringify(event) + '\n')
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	state := store.NewStore()
	service := devtools.NewService(state, nil)
	defer service.Shutdown()
	worker := NewProjectIndexWorker(script)
	defer worker.Close()
	service.WithProjectIndexer(worker)
	service.RegisterIndexSnapshot(context.Background(), store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "project"},
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:previous", Kind: "prompt", Name: "previous", Fidelity: "resolved", Status: "active"},
		},
	})

	if _, err := service.ReindexProject(context.Background(), root, "", "project"); err == nil {
		t.Fatal("ReindexProject error = nil, want corrupt stream rejected")
	}

	index := state.GetIndex()
	if findTestDefinition(index.Definitions, "prompt:corrupt") != nil {
		t.Fatalf("definitions = %+v, want corrupt streamed fact ignored", index.Definitions)
	}
	if findTestDefinition(index.Definitions, "prompt:previous") == nil {
		t.Fatalf("definitions = %+v, want previous index preserved", index.Definitions)
	}
}

func findTestDefinition(definitions []store.ProjectDefinition, id string) *store.ProjectDefinition {
	for i := range definitions {
		if definitions[i].ID == id {
			return &definitions[i]
		}
	}
	return nil
}
