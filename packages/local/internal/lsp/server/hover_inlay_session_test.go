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
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestScriptedHoverAndInlaySessionMatchesGolden(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "writer.ts")
	if err := os.WriteFile(file, []byte("prompt({\n})\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	server := New(Options{Version: "0.6.0-test", ClientRequestTimeout: time.Second})
	server.workspace = &hoverInlayWorkspace{server: server, root: root, file: file}
	input, inputWriter := io.Pipe()
	outputReader, outputWriter := io.Pipe()
	done := make(chan error, 1)
	go func() {
		done <- jsonrpc.Serve(context.Background(), input, outputWriter, io.Discard, server)
	}()
	writer, reader := jsonrpc.NewWriter(inputWriter), jsonrpc.NewReader(outputReader)
	writeMessage(t, writer, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
		"rootUri":"file://`+filepath.ToSlash(root)+`",
		"capabilities":{"textDocument":{"hover":{"contentFormat":["markdown"]}},"workspace":{"inlayHint":{"refreshSupport":true}}}
	}}`)
	readMessage(t, reader)
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"initialized"}`)
	readMessage(t, reader)

	uri := "file://" + filepath.ToSlash(file)
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":{"uri":"`+uri+`","languageId":"typescript","version":1,"text":""}}}`)
	readMessage(t, reader)
	requests := []string{
		`{"jsonrpc":"2.0","id":2,"method":"textDocument/hover","params":{"textDocument":{"uri":"` + uri + `"},"position":{"line":0,"character":3}}}`,
		inlaySessionRequest(3, uri),
	}
	var transcript bytes.Buffer
	for _, request := range requests {
		writeMessage(t, writer, request)
		transcript.Write(readMessage(t, reader))
		transcript.WriteByte('\n')
	}
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"textDocument/didChange","params":{
		"textDocument":{"uri":"`+uri+`","version":2},
		"contentChanges":[{"range":{"start":{"line":0,"character":2},"end":{"line":0,"character":2}},"text":"XX"}]
	}}`)
	readMessage(t, reader)
	writeMessage(t, writer, inlaySessionRequest(4, uri))
	transcript.Write(readMessage(t, reader))
	transcript.WriteByte('\n')

	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"workspace/didChangeConfiguration","params":{
		"settings":{"crux":{"inlayHints":{"enabled":false}}}
	}}`)
	refresh := readMessage(t, reader)
	transcript.Write(refresh)
	transcript.WriteByte('\n')
	writeMessage(t, writer, `{"jsonrpc":"2.0","id":1,"result":null}`)
	writeMessage(t, writer, inlaySessionRequest(5, uri))
	transcript.Write(readMessage(t, reader))
	transcript.WriteByte('\n')

	want, err := os.ReadFile(filepath.Join("testdata", "hover-inlay.output"))
	if err != nil {
		t.Fatalf("read hover/inlay golden: %v\n--- got ---\n%s", err, transcript.String())
	}
	if transcript.String() != string(want) {
		t.Fatalf("hover/inlay transcript mismatch\n--- got ---\n%s--- want ---\n%s", transcript.String(), want)
	}

	writeMessage(t, writer, `{"jsonrpc":"2.0","id":6,"method":"shutdown"}`)
	readMessage(t, reader)
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"exit"}`)
	_ = inputWriter.Close()
	_ = outputReader.Close()
	select {
	case err := <-done:
		if err != nil && err != io.ErrClosedPipe {
			t.Fatalf("serve hover/inlay session: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("scripted hover/inlay session did not exit")
	}
}

func inlaySessionRequest(id int, uri string) string {
	return `{"jsonrpc":"2.0","id":` + strconv.Itoa(id) +
		`,"method":"textDocument/inlayHint","params":{"textDocument":{"uri":"` + uri +
		`"},"range":{"start":{"line":0,"character":0},"end":{"line":2,"character":0}}}}`
}

type hoverInlayWorkspace struct {
	workspaceController
	server    *Server
	root      string
	file      string
	store     *readmodel.Store
	publisher *Publisher
}

func (w *hoverInlayWorkspace) Start(ctx context.Context, _ []protocol.WorkspaceFolder, _ Settings) {
	column, endLine, endColumn := 1, 2, 2
	definition := api.ProjectDefinition{
		ID: "prompt:writer", Kind: "prompt", Name: "Writer", Description: "Writes carefully.",
		Source: &api.SourceLoc{File: w.file, Line: 1, Column: &column},
		SourceSnippet: &api.SourceSnippet{Source: "prompt({\n})", Range: api.SourceRange{
			File: w.file, StartLine: 1, EndLine: &endLine, StartColumn: &column, EndColumn: &endColumn,
		}},
	}
	w.store = readmodel.NewStore()
	w.store.ApplySnapshot("scope", readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{definition},
		Relations: []api.ProjectRelation{
			{ID: "incoming", From: "agent:writer", To: definition.ID},
			{ID: "outgoing", From: definition.ID, To: "tool:writer"},
		},
		Findings: []api.IndexLintFinding{{
			ID: "finding", RuleID: "test.rule", Severity: "warning", Title: "Missing eval",
			Profiles: []string{"recommended"}, PrimaryDefinitionID: definition.ID,
			Source: &api.SourceLoc{File: w.file, Line: 1},
		}},
	})
	w.publisher = NewPublisher(PublisherOptions{
		ScopeID: "scope", Root: w.root, Store: w.store,
		Notify: func(method string, params any) { w.server.Notify(ctx, method, params) },
	})
	w.publisher.Change(readmodel.Change{Scope: "scope", Immediate: true})
}

func (w *hoverInlayWorkspace) UpdateSettings(Settings) {}
func (w *hoverInlayWorkspace) DidOpen(uri protocol.DocumentURI, version int) {
	w.publisher.DidOpen(uri, version)
}
func (w *hoverInlayWorkspace) DidChange(uri protocol.DocumentURI, version int, changes []protocol.TextDocumentContentChangeEvent) {
	w.publisher.DidChange(uri, version, changes)
}
func (w *hoverInlayWorkspace) DidSave(uri protocol.DocumentURI)  { w.publisher.DidSave(uri) }
func (w *hoverInlayWorkspace) DidClose(uri protocol.DocumentURI) { w.publisher.DidClose(uri) }
func (w *hoverInlayWorkspace) DisplayedFindings(uri protocol.DocumentURI, position protocol.Position) []displayedFinding {
	return w.publisher.DisplayedFindings(uri, position)
}
func (w *hoverInlayWorkspace) DefinitionSummaryAt(uri protocol.DocumentURI, position protocol.Position) (definitionSummary, bool) {
	return w.publisher.DefinitionSummaryAt(uri, position)
}
func (w *hoverInlayWorkspace) InlayHints(uri protocol.DocumentURI, range_ protocol.Range) []protocol.InlayHint {
	return buildInlayHints(w.publisher.DefinitionSummariesIn(uri), range_)
}
func (w *hoverInlayWorkspace) LeadingWhitespace(protocol.DocumentURI, uint32) (string, bool) {
	return "", true
}
func (w *hoverInlayWorkspace) Close() { w.publisher.Close() }
