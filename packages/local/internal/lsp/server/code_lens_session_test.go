package server

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestScriptedCodeLensSessionMatchesGolden(t *testing.T) {
	workspace := &codeLensWorkspaceStub{
		attached: true,
		port:     4603,
		summaries: []definitionSummary{{
			Definition: documentDefinition{
				Definition: api.ProjectDefinition{ID: "prompt:writer", Kind: "prompt"},
				Range:      protocol.Range{Start: protocol.Position{Line: 4, Character: 22}},
			},
			FindingCount: 1,
		}},
	}
	server := New(Options{Version: "0.6.0-test", ClientRequestTimeout: time.Second})
	server.workspace = workspace
	input, inputWriter := io.Pipe()
	outputReader, outputWriter := io.Pipe()
	done := make(chan error, 1)
	go func() {
		done <- jsonrpc.Serve(context.Background(), input, outputWriter, io.Discard, server)
	}()
	writer, reader := jsonrpc.NewWriter(inputWriter), jsonrpc.NewReader(outputReader)
	writeMessage(t, writer, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
		"clientInfo":{"name":"Cursor"},
		"capabilities":{"workspace":{"codeLens":{"refreshSupport":true}}},
		"initializationOptions":{"clientCommands":{"openDevtools":true}}
	}}`)
	readMessage(t, reader)
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"initialized"}`)

	var transcript bytes.Buffer
	writeMessage(t, writer, codeLensSessionRequest(2))
	transcript.Write(readMessage(t, reader))
	transcript.WriteByte('\n')
	workspace.setAttached(false)
	server.requestCodeLensRefresh()
	transcript.Write(readMessage(t, reader))
	transcript.WriteByte('\n')
	writeMessage(t, writer, `{"jsonrpc":"2.0","id":1,"result":null}`)
	writeMessage(t, writer, codeLensSessionRequest(3))
	transcript.Write(readMessage(t, reader))
	transcript.WriteByte('\n')
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"workspace/didChangeConfiguration","params":{
		"settings":{"crux":{"codeLens":{"enabled":false}}}
	}}`)
	transcript.Write(readMessage(t, reader))
	transcript.WriteByte('\n')
	writeMessage(t, writer, `{"jsonrpc":"2.0","id":2,"result":null}`)
	writeMessage(t, writer, codeLensSessionRequest(4))
	transcript.Write(readMessage(t, reader))
	transcript.WriteByte('\n')

	want, err := os.ReadFile(filepath.Join("testdata", "code-lens.output"))
	if err != nil {
		t.Fatal(err)
	}
	if transcript.String() != string(want) {
		t.Fatalf("code lens transcript mismatch\n--- got ---\n%s--- want ---\n%s", transcript.String(), want)
	}

	writeMessage(t, writer, `{"jsonrpc":"2.0","id":5,"method":"shutdown"}`)
	readMessage(t, reader)
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"exit"}`)
	_ = inputWriter.Close()
	_ = outputReader.Close()
	select {
	case err := <-done:
		if err != nil && err != io.ErrClosedPipe {
			t.Fatalf("serve code lens session: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("scripted code lens session did not exit")
	}
}

func codeLensSessionRequest(id int) string {
	return `{"jsonrpc":"2.0","id":` + strconv.Itoa(id) +
		`,"method":"textDocument/codeLens","params":{"textDocument":{"uri":"file:///repo/src/writer.ts"}}}`
}
