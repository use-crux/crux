package workers

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestCreateDeploymentManifestUsesTypedWorkerArtifact(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}
	script := filepath.Join(t.TempDir(), "deployment-manifest-worker.mjs")
	if err := os.WriteFile(script, []byte(`
		import readline from 'node:readline'
		const rl = readline.createInterface({ input: process.stdin, terminal: false })
		rl.on('line', (line) => {
			const req = JSON.parse(line)
			if (req.method !== 'createDeploymentManifest' || req.projectId !== 'fixture') {
				process.stdout.write(JSON.stringify({ error: 'unexpected manifest request' }) + '\n')
				return
			}
			if (req.definitions[0]?.id !== 'prompt:writer' || req.staticFrontend !== 'fixture' || req.semanticStatus !== 'partial') {
				process.stdout.write(JSON.stringify({ error: 'missing manifest projection input' }) + '\n')
				return
			}
			process.stdout.write(JSON.stringify({
				protocolVersion: 2,
				type: 'artifact:done',
				transactionId: 'artifact:deploymentManifest',
				artifact: 'deploymentManifest',
				root: req.root,
				payload: { schemaVersion: 1, projectId: req.projectId, manifestId: 'pim_fixture' }
			}) + '\n')
		})
	`), 0o600); err != nil {
		t.Fatal(err)
	}

	worker := newTestWorkerWithProjectScript(t, script)
	defer worker.Close()
	payload, err := worker.CreateDeploymentManifest(context.Background(), projectindex.DeploymentManifestProjectionInput{
		Root:           t.TempDir(),
		ProjectID:      "fixture",
		Definitions:    []store.ProjectDefinition{{ID: "prompt:writer"}},
		StaticFrontend: "fixture",
		SemanticStatus: "partial",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(payload), `"projectId":"fixture"`) {
		t.Fatalf("payload = %s", payload)
	}
}
