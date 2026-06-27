package runtime

import (
	"context"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestWorker_runtimePatchUsesDedicatedStreamProtocol(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "runtime-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		process.stdin.setEncoding('utf8')
		let header
		const definitions = []
		process.stdin.on('data', (chunk) => {
			for (const line of chunk.trim().split('\n')) {
				if (!line) continue
				const req = JSON.parse(line)
				if (req.requestKind === 'start') {
					header = req
					continue
				}
				if (req.requestKind === 'previousIndex:definitions') {
					definitions.push(...(req.previousIndexDefinitions || []))
					continue
				}
				if (req.requestKind === 'done') {
					if (!header || header.method !== 'indexProjectRuntime' || header.protocolVersion !== 2) {
						process.stdout.write(JSON.stringify({
							protocolVersion: 2,
							type: 'phase:error',
							transactionId: 'tx-error',
							phase: 'runtime',
							error: { message: 'expected streamed indexProjectRuntime request' }
						}) + '\n')
						return
					}
					if (!definitions.some((definition) => definition.id === 'prompt:previous')) {
						process.stdout.write(JSON.stringify({
							protocolVersion: 2,
							type: 'phase:error',
							transactionId: 'tx-error',
							phase: 'runtime',
							error: { message: 'missing chunked previous definition' }
						}) + '\n')
						return
					}
					const events = [
						{
							protocolVersion: 2,
							type: 'phase:start',
							transactionId: 'tx-runtime',
							phase: 'runtime',
							root: header.root,
							startedAt: new Date(0).toISOString()
						},
						{
							protocolVersion: 2,
							type: 'fact:batch',
							transactionId: 'tx-runtime',
							sequence: 0,
							facts: [{
								schemaVersion: 1,
								factId: 'definitions:prompt:runtime',
								kind: 'definitions',
								phase: 'runtime',
								projectRoot: header.root,
								producer: { name: '@use-crux/indexer/project-runtime-indexer', version: 'test' },
								fidelity: 'runtime-observed',
								provenance: { kind: 'runtime', attribute: 'project-index.runtime' },
								fact: { id: 'prompt:runtime', kind: 'prompt', name: 'runtime', fidelity: 'resolved', status: 'active' }
							}]
						},
						{
							protocolVersion: 2,
							type: 'phase:done',
							transactionId: 'tx-runtime',
							phase: 'runtime',
							patch: {
								schemaVersion: 1,
								phase: 'runtime',
								project: { root: header.root, name: header.projectName },
								startedAt: new Date(0).toISOString(),
								finishedAt: new Date(0).toISOString(),
								status: 'ok'
							},
							summary: { factCount: 1 }
						}
					]
					for (const event of events) process.stdout.write(JSON.stringify(event) + '\n')
				}
			}
		})
	`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := New(Options{ScriptPath: script})
	defer worker.Close()

	patch, err := worker.IndexProjectRuntimePatch(
		context.Background(),
		projectindex.ProjectRuntimeIndexRequest{
			Root:        t.TempDir(),
			ProjectName: "runtime-project",
			PreviousIndex: store.IndexData{
				Definitions: []store.ProjectDefinition{
					{ID: "prompt:previous", Kind: "prompt", Name: "previous", Fidelity: "partial", Status: "active"},
				},
			},
			Budget: projectindex.IndexPatchBudget{MaxDefinitions: 10},
		},
	)
	if err != nil {
		t.Fatalf("IndexProjectRuntimePatch error = %v", err)
	}
	if patch.Phase != "runtime" {
		t.Fatalf("patch phase = %q, want runtime", patch.Phase)
	}
	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:runtime" {
		t.Fatalf("definitions = %+v, want streamed runtime definition", patch.Facts.Definitions)
	}
	if len(patch.FactEnvelopes) != 1 {
		t.Fatalf("fact envelopes = %+v, want one runtime envelope", patch.FactEnvelopes)
	}
	if patch.FactEnvelopes[0].Producer.Name != "@use-crux/indexer/project-runtime-indexer" {
		t.Fatalf("producer = %+v, want runtime worker producer", patch.FactEnvelopes[0].Producer)
	}
	if patch.FactEnvelopes[0].Fidelity != "runtime-observed" {
		t.Fatalf("fidelity = %q, want runtime-observed", patch.FactEnvelopes[0].Fidelity)
	}
}
