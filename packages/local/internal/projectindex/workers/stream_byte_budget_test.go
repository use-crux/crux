package workers

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/requestwire"
)

func TestWorkerAcceptsPatchStreamsOverSingleLineByteLimit(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "large-stream-indexer.mjs")
	if err := os.WriteFile(script, []byte(`
		import readline from 'node:readline'

		const payload = 'x'.repeat(2 * 1024 * 1024)
		const rl = readline.createInterface({ input: process.stdin, terminal: false })

		rl.on('line', (line) => {
			const req = JSON.parse(line)
			const tx = 'tx-large-stream'
			process.stdout.write(JSON.stringify({
				protocolVersion: 2,
				type: 'phase:start',
				transactionId: tx,
				phase: 'ast',
				root: req.root,
				startedAt: new Date(0).toISOString()
			}) + '\n')

			for (let index = 0; index < 10; index += 1) {
				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'fact:batch',
					transactionId: tx,
					sequence: index,
					facts: [{
						schemaVersion: 1,
						factId: 'diagnostics:large-' + index,
						kind: 'diagnostics',
						phase: 'ast',
						projectRoot: req.root,
						producer: { name: '@use-crux/indexer/project-indexer', version: 'test' },
						fidelity: 'inferred',
						provenance: { kind: 'runtime', attribute: 'project-index.ast' },
						fact: {
							id: 'diagnostic:large-' + index,
							severity: 'info',
							code: 'index.large_stream',
							message: payload
						}
					}]
				}) + '\n')
			}

				process.stdout.write(JSON.stringify({
					protocolVersion: 2,
					type: 'phase:done',
					transactionId: tx,
					phase: 'ast',
				patch: {
					schemaVersion: 1,
					phase: 'ast',
					project: { root: req.root },
					startedAt: new Date(0).toISOString(),
					finishedAt: new Date(0).toISOString(),
					status: 'ok'
				},
					summary: { factCount: 10 }
				}) + '\n', () => process.exit(0))
			})
		`), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	worker := newTestWorkerWithProjectScript(t, script)
	defer worker.Close()

	patches, err := worker.streamPatches(
		context.Background(),
		requestwire.Request{Method: "indexProjectRuntime", Root: t.TempDir(), ProjectName: "large-stream"},
		projectindex.IndexPatchBudget{},
	)
	if err != nil {
		t.Fatalf("streamPatches error = %v", err)
	}
	if len(patches) != 1 {
		t.Fatalf("patches = %d, want 1", len(patches))
	}
	patch := patches[0]
	if len(patch.Facts.Diagnostics) != 10 {
		t.Fatalf("diagnostics = %d, want 10", len(patch.Facts.Diagnostics))
	}
}
