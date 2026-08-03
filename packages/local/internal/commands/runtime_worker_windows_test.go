//go:build windows

package commands

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestRuntimeWorkerCancellationUsesStdinShutdown(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is not installed")
	}
	marker := filepath.Join(t.TempDir(), "stopped")
	script := filepath.Join(t.TempDir(), "worker.mjs")
	program := `
import { writeFile } from 'node:fs/promises'
await new Promise((resolve) => {
  process.once('SIGTERM', async () => {
    await writeFile(process.argv[2], 'stopped')
    resolve()
  })
})
`
	if err := os.WriteFile(script, []byte(program), 0o600); err != nil {
		t.Fatal(err)
	}
	cmd := newRuntimeWorkerProcessCommand(node, script, marker)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if err := superviseRuntimeWorkerProcess(ctx, cmd); err != nil {
		t.Fatalf("superviseRuntimeWorkerProcess() error = %v, want nil", err)
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("Runtime worker did not handle stdin shutdown: %v", err)
	}
}
