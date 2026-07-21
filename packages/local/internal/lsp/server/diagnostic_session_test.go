package server

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestScriptedSessionPublishesFixtureSnapshotGolden(t *testing.T) {
	root, err := filepath.Abs(filepath.Join("..", "testdata", "fixture-project"))
	if err != nil {
		t.Fatal(err)
	}
	input, inputWriter := io.Pipe()
	outputReader, output := io.Pipe()
	server := New(Options{Version: "0.6.0-test"})
	workspace := &snapshotWorkspace{server: server, root: root}
	server.workspace = workspace
	done := make(chan error, 1)
	go func() {
		done <- jsonrpc.Serve(context.Background(), input, output, io.Discard, server)
	}()

	writer := jsonrpc.NewWriter(inputWriter)
	reader := jsonrpc.NewReader(outputReader)
	writeMessage(t, writer, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"rootUri":"file://`+root+`"}}`)
	readMessage(t, reader) // InitializeResult is pinned by lifecycle.output.
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"initialized"}`)
	diagnostic := readMessage(t, reader)

	normalized := strings.ReplaceAll(string(diagnostic), "file://"+filepath.ToSlash(root), "file://<ROOT>") + "\n"
	want, err := os.ReadFile(filepath.Join("testdata", "diagnostics.output"))
	if err != nil {
		t.Fatal(err)
	}
	if normalized != string(want) {
		t.Fatalf("diagnostic transcript mismatch\n--- got ---\n%s--- want ---\n%s", normalized, want)
	}

	writeMessage(t, writer, `{"jsonrpc":"2.0","id":2,"method":"shutdown"}`)
	readMessage(t, reader)
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"exit"}`)
	_ = inputWriter.Close()
	_ = outputReader.Close()
	select {
	case err := <-done:
		if err != nil && err != io.ErrClosedPipe {
			t.Fatalf("serve scripted diagnostics: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("scripted diagnostics session did not exit")
	}
}

type snapshotWorkspace struct {
	server    *Server
	root      string
	publisher *Publisher
}

func (w *snapshotWorkspace) Start(ctx context.Context, _ []protocol.WorkspaceFolder, _ Settings) {
	store := readmodel.NewStore()
	generation := uint64(7)
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Findings:   []api.IndexLintFinding{fixtureFinding()},
	})
	w.publisher = NewPublisher(PublisherOptions{
		ScopeID: "scope", Root: w.root,
		ConfigFile: filepath.Join(w.root, "crux.config.ts"), Store: store,
		Notify: func(method string, params any) { w.server.Notify(ctx, method, params) },
	})
	w.publisher.Change(readmodel.Change{Scope: "scope", Files: []string{"src/writer.ts"}, Immediate: true})
}

func (w *snapshotWorkspace) UpdateSettings(Settings)      {}
func (w *snapshotWorkspace) DidOpen(protocol.DocumentURI) {}
func (w *snapshotWorkspace) DidSave(protocol.DocumentURI) {}
func (w *snapshotWorkspace) LeadingWhitespace(protocol.DocumentURI, uint32) (string, bool) {
	return "", true
}
func (w *snapshotWorkspace) Close() {
	if w.publisher != nil {
		w.publisher.Close()
	}
}

func fixtureFinding() api.IndexLintFinding {
	column := 23
	return api.IndexLintFinding{
		ID:       "lint:definition.missing_eval_coverage:prompt:lsp-fixture-writer",
		Severity: "info", RuleID: "definition.missing_eval_coverage", Category: "evals", Maturity: "preview",
		Profiles: []string{"recommended", "strict"}, Title: "Definition has no eval coverage",
		Message: `prompt "lsp-fixture-writer" is not covered by an Eval relation.`,
		Source:  &api.SourceLoc{File: "src/writer.ts", Line: 5, Column: &column},
		DocsURL: "/docs/reference/crux-core/index-lints/definition-missing-eval-coverage",
		Suppression: &api.IndexLintSuppression{
			Supported: true,
			Directive: "// crux-lint-disable-next-line definition.missing_eval_coverage -- reason",
			Scope:     "next-line",
		},
	}
}

func writeMessage(t *testing.T, writer *jsonrpc.Writer, payload string) {
	t.Helper()
	if !json.Valid([]byte(payload)) {
		t.Fatalf("invalid scripted JSON: %s", payload)
	}
	if err := writer.Write([]byte(payload)); err != nil {
		t.Fatal(err)
	}
}

func readMessage(t *testing.T, reader *jsonrpc.Reader) []byte {
	t.Helper()
	type result struct {
		payload []byte
		err     error
	}
	results := make(chan result, 1)
	go func() {
		payload, err := reader.Read()
		results <- result{payload: payload, err: err}
	}()
	select {
	case value := <-results:
		if value.err != nil {
			t.Fatal(value.err)
		}
		return value.payload
	case <-time.After(time.Second):
		t.Fatal("timed out reading scripted LSP response")
		return nil
	}
}
