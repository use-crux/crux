package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
)

type devPreflightContextKey struct{}

func TestDevPreflightReceivesCommandContextAndInjectedIO(t *testing.T) {
	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{})
	root := context.WithValue(context.Background(), devPreflightContextKey{}, "root")
	observed := false
	cmd := newDevCmd(cli.NewFactoryWithStreams(streams), devDependencies{
		serverRunning: func(int) bool { return true },
		runtimePreflight: func(ctx context.Context, io *output.IO) {
			observed = ctx.Value(devPreflightContextKey{}) == "root" && io == streams
		},
	})

	if err := cmd.ExecuteContext(root); err != nil {
		t.Fatalf("execute dev: %v", err)
	}
	if !observed {
		t.Fatal("dev preflight did not receive command context and injected IO")
	}
}

func TestDevPreflightRetainsContextAndWritesDiagnosticsToErr(t *testing.T) {
	oldRunner := runRuntimeOperationForCommand
	defer func() { runRuntimeOperationForCommand = oldRunner }()

	root := context.WithValue(context.Background(), devPreflightContextKey{}, "root")
	ctx, cancel := context.WithCancel(root)
	cancel()
	observedContext := false
	runRuntimeOperationForCommand = func(got context.Context, _, operation, _ string, _ commandWorkerProcess) (json.RawMessage, error) {
		if operation != "preflight" {
			t.Fatalf("unexpected operation %q", operation)
		}
		observedContext = got.Value(devPreflightContextKey{}) == "root" && errors.Is(got.Err(), context.Canceled)
		return nil, errors.New("preflight broke")
	}

	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{})
	printRuntimePreflight(ctx, streams, streams.Err, t.TempDir())

	if !observedContext {
		t.Fatal("runtime preflight did not retain the command context")
	}
	if out.Len() != 0 {
		t.Fatalf("runtime preflight wrote diagnostics to stdout: %q", out.String())
	}
	if diagnostic := errOut.String(); !strings.Contains(diagnostic, "Runtime preflight preflight failed") || !strings.Contains(diagnostic, "preflight broke") {
		t.Fatalf("runtime preflight stderr missing diagnostic: %q", diagnostic)
	}
}
