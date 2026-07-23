package server

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestScriptedNavigationMethodsMatchGolden(t *testing.T) {
	root, err := filepath.Abs(filepath.Join("..", "testdata", "navigation-project"))
	if err != nil {
		t.Fatal(err)
	}
	publisher := navigationTestPublisher(t, "scope", root, auditedNavigationSnapshot(root))
	runtime := &workspaceRuntime{sessions: []*scopeSession{{
		scope: readmodel.Scope{ID: "scope", Root: root}, folderName: "navigation-project", publisher: publisher,
	}}}
	server := New(Options{Version: "0.6.0-test"})
	server.workspace = &scriptedNavigationWorkspace{runtime: runtime}

	input, inputWriter := io.Pipe()
	outputReader, output := io.Pipe()
	done := make(chan error, 1)
	go func() { done <- jsonrpc.Serve(context.Background(), input, output, io.Discard, server) }()
	writer, reader := jsonrpc.NewWriter(inputWriter), jsonrpc.NewReader(outputReader)
	writeMessage(t, writer, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"rootUri":"file://`+filepath.ToSlash(root)+`"}}`)
	readMessage(t, reader)
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"initialized"}`)

	agentURI := "file://" + filepath.ToSlash(filepath.Join(root, "src", "agent.ts"))
	schemaURI := "file://" + filepath.ToSlash(filepath.Join(root, "src", "schema.ts"))
	targetURI := "file://" + filepath.ToSlash(filepath.Join(root, "src", "primitives.ts"))
	requests := []string{
		`{"jsonrpc":"2.0","id":2,"method":"textDocument/definition","params":{"textDocument":{"uri":"` + agentURI + `"},"position":{"line":4,"character":33}}}`,
		`{"jsonrpc":"2.0","id":3,"method":"textDocument/definition","params":{"textDocument":{"uri":"` + schemaURI + `"},"position":{"line":3,"character":27}}}`,
		`{"jsonrpc":"2.0","id":4,"method":"textDocument/definition","params":{"textDocument":{"uri":"` + targetURI + `"},"position":{"line":4,"character":28}}}`,
		`{"jsonrpc":"2.0","id":5,"method":"textDocument/definition","params":{"textDocument":{"uri":"` + targetURI + `"},"position":{"line":0,"character":0}}}`,
		`{"jsonrpc":"2.0","id":6,"method":"textDocument/references","params":{"textDocument":{"uri":"` + targetURI + `"},"position":{"line":4,"character":28},"context":{"includeDeclaration":false}}}`,
		`{"jsonrpc":"2.0","id":7,"method":"textDocument/references","params":{"textDocument":{"uri":"` + targetURI + `"},"position":{"line":4,"character":28},"context":{"includeDeclaration":true}}}`,
		`{"jsonrpc":"2.0","id":8,"method":"textDocument/references","params":{"textDocument":{"uri":"` + targetURI + `"},"position":{"line":0,"character":0},"context":{"includeDeclaration":false}}}`,
		`{"jsonrpc":"2.0","id":9,"method":"textDocument/references","params":{"textDocument":{"uri":"` + agentURI + `"},"position":{"line":4,"character":33},"context":{"includeDeclaration":false}}}`,
		`{"jsonrpc":"2.0","id":10,"method":"workspace/symbol","params":{"query":"navigation-writer"}}`,
		`{"jsonrpc":"2.0","id":11,"method":"workspace/symbol","params":{"query":"missing"}}`,
		`{"jsonrpc":"2.0","id":12,"method":"workspace/symbol","params":{"query":""}}`,
		`{"jsonrpc":"2.0","id":13,"method":"textDocument/documentSymbol","params":{"textDocument":{"uri":"` + targetURI + `"}}}`,
		`{"jsonrpc":"2.0","id":14,"method":"textDocument/documentSymbol","params":{"textDocument":{"uri":"file://` + filepath.ToSlash(filepath.Join(root, "src", "missing.ts")) + `"}}}`,
	}
	var transcript bytes.Buffer
	for _, request := range requests {
		writeMessage(t, writer, request)
		message := readMessage(t, reader)
		transcript.WriteString(strings.ReplaceAll(string(message), "file://"+filepath.ToSlash(root), "file://<ROOT>"))
		transcript.WriteByte('\n')
	}
	want, err := os.ReadFile(filepath.Join("testdata", "navigation.output"))
	if err != nil {
		t.Fatalf("read navigation golden: %v\n--- got ---\n%s", err, transcript.String())
	}
	if transcript.String() != string(want) {
		t.Fatalf("navigation transcript mismatch\n--- got ---\n%s--- want ---\n%s", transcript.String(), want)
	}

	writeMessage(t, writer, `{"jsonrpc":"2.0","id":15,"method":"shutdown"}`)
	readMessage(t, reader)
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"exit"}`)
	_ = inputWriter.Close()
	_ = outputReader.Close()
	select {
	case err := <-done:
		if err != nil && err != io.ErrClosedPipe {
			t.Fatalf("serve navigation session: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("scripted navigation session did not exit")
	}
}

type scriptedNavigationWorkspace struct {
	workspaceController
	runtime *workspaceRuntime
}

func (w *scriptedNavigationWorkspace) Start(context.Context, []protocol.WorkspaceFolder, Settings) {}
func (w *scriptedNavigationWorkspace) Close()                                                      {}
func (w *scriptedNavigationWorkspace) DefinitionLocation(uri protocol.DocumentURI, position protocol.Position) (protocol.Location, bool) {
	return w.runtime.DefinitionLocation(uri, position)
}
func (w *scriptedNavigationWorkspace) ReferenceLocations(uri protocol.DocumentURI, position protocol.Position, include bool) []protocol.Location {
	return w.runtime.ReferenceLocations(uri, position, include)
}
func (w *scriptedNavigationWorkspace) DocumentSymbols(uri protocol.DocumentURI) []protocol.DocumentSymbol {
	return w.runtime.DocumentSymbols(uri)
}
func (w *scriptedNavigationWorkspace) WorkspaceSymbols(query string) ([]protocol.SymbolInformation, bool) {
	return w.runtime.WorkspaceSymbols(query)
}
