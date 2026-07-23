package server

import (
	"context"
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

func TestScriptedSessionShiftsDirtyDiagnosticsAndAppliesHeldViewOnSave(t *testing.T) {
	root, err := filepath.Abs(filepath.Join("..", "testdata", "fixture-project"))
	if err != nil {
		t.Fatal(err)
	}
	input, inputWriter := io.Pipe()
	outputReader, output := io.Pipe()
	server := New(Options{Version: "0.6.0-test"})
	workspace := &rangeShiftWorkspace{server: server, root: root}
	server.workspace = workspace
	done := make(chan error, 1)
	go func() {
		done <- jsonrpc.Serve(context.Background(), input, output, io.Discard, server)
	}()

	writer := jsonrpc.NewWriter(inputWriter)
	reader := jsonrpc.NewReader(outputReader)
	writeMessage(t, writer, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"rootUri":"file://`+root+`","capabilities":{"textDocument":{"hover":{"contentFormat":["markdown"]}}}}}`)
	readMessage(t, reader)
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"initialized"}`)
	transcript := [][]byte{readMessage(t, reader)}

	uri := "file://" + filepath.ToSlash(filepath.Join(root, "src", "writer.ts"))
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":{"uri":"`+uri+`","languageId":"typescript","version":1,"text":""}}}`)
	transcript = append(transcript, readMessage(t, reader))
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"textDocument/didChange","params":{"textDocument":{"uri":"`+uri+`","version":2},"contentChanges":[{"range":{"start":{"line":1,"character":0},"end":{"line":1,"character":0}},"text":"\n\n"}]}}`)
	transcript = append(transcript, readMessage(t, reader))
	writeMessage(t, writer, `{"jsonrpc":"2.0","id":3,"method":"textDocument/hover","params":{"textDocument":{"uri":"`+uri+`"},"position":{"line":6,"character":22}}}`)
	transcript = append(transcript, readMessage(t, reader))
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"textDocument/didSave","params":{"textDocument":{"uri":"`+uri+`"}}}`)
	transcript = append(transcript, readMessage(t, reader))

	var normalized strings.Builder
	for _, message := range transcript {
		normalized.WriteString(strings.ReplaceAll(string(message), "file://"+filepath.ToSlash(root), "file://<ROOT>"))
		normalized.WriteByte('\n')
	}
	want, err := os.ReadFile(filepath.Join("testdata", "range-shift.output"))
	if err != nil {
		t.Fatalf("read range-shift golden: %v\n--- got ---\n%s", err, normalized.String())
	}
	if normalized.String() != string(want) {
		t.Fatalf("range-shift transcript mismatch\n--- got ---\n%s--- want ---\n%s", normalized.String(), want)
	}

	writeMessage(t, writer, `{"jsonrpc":"2.0","id":2,"method":"shutdown"}`)
	readMessage(t, reader)
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"exit"}`)
	_ = inputWriter.Close()
	_ = outputReader.Close()
	select {
	case err := <-done:
		if err != nil && err != io.ErrClosedPipe {
			t.Fatalf("serve range-shift session: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("scripted range-shift session did not exit")
	}
}

type rangeShiftWorkspace struct {
	server    *Server
	root      string
	store     *readmodel.Store
	publisher *Publisher
}

func (w *rangeShiftWorkspace) Start(ctx context.Context, _ []protocol.WorkspaceFolder, _ Settings) {
	w.store = readmodel.NewStore()
	generation := uint64(7)
	w.store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Findings:   []api.IndexLintFinding{fixtureFinding()},
	})
	w.publisher = NewPublisher(PublisherOptions{
		ScopeID: "scope", Root: w.root,
		ConfigFile: filepath.Join(w.root, "crux.config.ts"), Store: w.store,
		Notify: func(method string, params any) { w.server.Notify(ctx, method, params) },
	})
	w.publisher.Change(readmodel.Change{Scope: "scope", Files: []string{"src/writer.ts"}, Immediate: true})
}

func (w *rangeShiftWorkspace) UpdateSettings(Settings) {}
func (w *rangeShiftWorkspace) DidOpen(uri protocol.DocumentURI, version int) {
	w.publisher.DidOpen(uri, version)
}
func (w *rangeShiftWorkspace) DidChange(uri protocol.DocumentURI, version int, changes []protocol.TextDocumentContentChangeEvent) {
	w.publisher.DidChange(uri, version, changes)
	generation := uint64(8)
	w.store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Findings:   []api.IndexLintFinding{fixtureFinding()},
	})
	w.publisher.Change(readmodel.Change{Scope: "scope", Files: []string{"src/writer.ts"}, Immediate: true})
}
func (w *rangeShiftWorkspace) DidSave(uri protocol.DocumentURI)  { w.publisher.DidSave(uri) }
func (w *rangeShiftWorkspace) DidClose(uri protocol.DocumentURI) { w.publisher.DidClose(uri) }
func (w *rangeShiftWorkspace) DisplayedFindings(uri protocol.DocumentURI, position protocol.Position) []displayedFinding {
	return w.publisher.DisplayedFindings(uri, position)
}
func (w *rangeShiftWorkspace) LeadingWhitespace(protocol.DocumentURI, uint32) (string, bool) {
	return "", true
}
func (w *rangeShiftWorkspace) Close() {
	if w.publisher != nil {
		w.publisher.Close()
	}
}
