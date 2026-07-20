package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/output"
)

func TestRuntimeGeneratePreflightInheritsCommandContext(t *testing.T) {
	previous := runRuntimeOperationForCommand
	t.Cleanup(func() { runRuntimeOperationForCommand = previous })
	type contextKey struct{}
	root := context.WithValue(context.Background(), contextKey{}, "root")
	var observed context.Context
	runRuntimeOperationForCommand = func(ctx context.Context, _, _, _ string, _ commandWorkerProcess) (json.RawMessage, error) {
		observed = ctx
		return json.RawMessage(`{"setup":{"ok":true}}`), nil
	}
	streams := output.NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, output.TestIOOptions{})

	printRuntimeGeneratePreflight(root, streams, t.TempDir(), json.RawMessage(`{}`))

	if observed == nil || observed.Value(contextKey{}) != "root" {
		t.Fatal("runtime generate preflight did not inherit command context")
	}
}
