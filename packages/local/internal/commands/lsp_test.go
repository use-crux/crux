package commands

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestLSPCommandWritesNothingBeforeFirstResponse(t *testing.T) {
	t.Parallel()

	command := NewLSPCmd(&cli.Factory{})
	command.SetIn(bytes.NewReader(nil))
	var stdout, stderr bytes.Buffer
	command.SetOut(&stdout)
	command.SetErr(&stderr)

	if err := command.Execute(); err != nil {
		t.Fatalf("execute lsp at EOF: %v", err)
	}
	if stdout.Len() != 0 {
		t.Fatalf("stdout before any JSON-RPC request = %q", stdout.Bytes())
	}
}

func TestLSPCommandUsesRootVersionInInitializeResult(t *testing.T) {
	t.Parallel()

	root := &cobra.Command{Use: "crux", Version: "0.6.0-test", SilenceErrors: true, SilenceUsage: true}
	root.AddCommand(NewLSPCmd(&cli.Factory{}))
	var input bytes.Buffer
	for _, payload := range [][]byte{
		[]byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`),
		[]byte(`{"jsonrpc":"2.0","id":2,"method":"shutdown"}`),
		[]byte(`{"jsonrpc":"2.0","method":"exit"}`),
	} {
		if err := jsonrpc.NewWriter(&input).Write(payload); err != nil {
			t.Fatal(err)
		}
	}
	var stdout, stderr bytes.Buffer
	root.SetIn(&input)
	root.SetOut(&stdout)
	root.SetErr(&stderr)
	root.SetArgs([]string{"lsp", "--root", t.TempDir()})

	if err := root.Execute(); err != nil {
		t.Fatalf("execute lsp lifecycle: %v, stderr=%s", err, stderr.String())
	}
	payload, err := jsonrpc.NewReader(&stdout).Read()
	if err != nil {
		t.Fatalf("read initialize response: %v", err)
	}
	var response struct {
		Result protocol.InitializeResult `json:"result"`
	}
	if err := json.Unmarshal(payload, &response); err != nil {
		t.Fatalf("decode initialize response: %v", err)
	}
	if response.Result.ServerInfo.Version != "0.6.0-test" {
		t.Fatalf("server version = %q, want explicit Cobra root version", response.Result.ServerInfo.Version)
	}
}
