package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestScriptedAttachedThreadDiagnosticsNavigationHoverAndCompletion(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "src", "thread.ts")
	source := strings.Join([]string{
		`import { prompt } from "@use-crux/core";`,
		`import { thread } from "@use-crux/core/thread";`,
		`export const conversation = thread({ id: "shared-conversation" });`,
		`export const duplicate = thread({ id: "shared-conversation" });`,
		`export const answer = prompt({`,
		`  use: [conver],`,
		`});`,
	}, "\n")

	server := New(Options{Version: "0.7.0-test"})
	workspace := &scriptedAttachedThreadWorkspace{server: server, root: root, file: file}
	server.workspace = workspace
	input, inputWriter := io.Pipe()
	outputReader, outputWriter := io.Pipe()
	done := make(chan error, 1)
	go func() {
		done <- jsonrpc.Serve(context.Background(), input, outputWriter, io.Discard, server)
	}()
	writer, reader := jsonrpc.NewWriter(inputWriter), jsonrpc.NewReader(outputReader)
	rootURI := "file://" + filepath.ToSlash(root)
	uri := "file://" + filepath.ToSlash(file)

	writeMessage(t, writer, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{`+
		`"rootUri":"`+rootURI+`","initializationOptions":{"workspaceTrust":true},`+
		`"capabilities":{"textDocument":{"hover":{"contentFormat":["markdown"]},`+
		`"publishDiagnostics":{"dataSupport":true}}}}}`)
	readMessage(t, reader)
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"initialized"}`)
	assertThreadDiagnostic(t, readMessage(t, reader), uri)

	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":{`+
		`"uri":"`+uri+`","languageId":"typescript","version":1,"text":`+quotedJSON(source)+`}}}`)
	assertThreadDiagnostic(t, readMessage(t, reader), uri)

	writeMessage(t, writer, `{"jsonrpc":"2.0","id":2,"method":"textDocument/documentSymbol","params":{`+
		`"textDocument":{"uri":"`+uri+`"}}}`)
	var symbolResponse struct {
		Result []protocol.DocumentSymbol `json:"result"`
	}
	decodeLSPMessage(t, readMessage(t, reader), &symbolResponse)
	if !containsThreadDocumentSymbol(symbolResponse.Result, "conversation") {
		t.Fatalf("Thread document symbol missing: %+v", symbolResponse.Result)
	}

	writeMessage(t, writer, `{"jsonrpc":"2.0","id":3,"method":"textDocument/definition","params":{`+
		`"textDocument":{"uri":"`+uri+`"},"position":{"line":5,"character":12}}}`)
	var definitionResponse struct {
		Result *protocol.Location `json:"result"`
	}
	decodeLSPMessage(t, readMessage(t, reader), &definitionResponse)
	if definitionResponse.Result == nil || string(definitionResponse.Result.URI) != uri ||
		definitionResponse.Result.Range.Start.Line != 2 {
		t.Fatalf("Thread definition navigation = %+v", definitionResponse.Result)
	}

	writeMessage(t, writer, `{"jsonrpc":"2.0","id":4,"method":"textDocument/hover","params":{`+
		`"textDocument":{"uri":"`+uri+`"},"position":{"line":2,"character":20}}}`)
	var hoverResponse struct {
		Result protocol.Hover `json:"result"`
	}
	decodeLSPMessage(t, readMessage(t, reader), &hoverResponse)
	if !strings.Contains(hoverResponse.Result.Contents.Value, "**conversation** — thread") {
		t.Fatalf("Thread hover = %q", hoverResponse.Result.Contents.Value)
	}

	writeMessage(t, writer, `{"jsonrpc":"2.0","id":5,"method":"textDocument/completion","params":{`+
		`"textDocument":{"uri":"`+uri+`"},"position":{"line":5,"character":14}}}`)
	var completionResponse struct {
		Result protocol.CompletionList `json:"result"`
	}
	decodeLSPMessage(t, readMessage(t, reader), &completionResponse)
	if len(completionResponse.Result.Items) != 1 ||
		completionResponse.Result.Items[0].Label != "conversation" ||
		completionResponse.Result.Items[0].TextEdit == nil ||
		completionResponse.Result.Items[0].TextEdit.NewText != "conversation" {
		t.Fatalf("Thread completion = %+v", completionResponse.Result)
	}
	if workspace.mode != readmodel.ModeAttached {
		t.Fatalf("workspace mode = %q, want ATTACHED", workspace.mode)
	}

	writeMessage(t, writer, `{"jsonrpc":"2.0","id":6,"method":"shutdown"}`)
	readMessage(t, reader)
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"exit"}`)
	_ = inputWriter.Close()
	_ = outputReader.Close()
	select {
	case err := <-done:
		if err != nil && err != io.ErrClosedPipe {
			t.Fatalf("serve Thread session: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("scripted Thread session did not exit")
	}
}

type scriptedAttachedThreadWorkspace struct {
	workspaceController
	server    *Server
	root      string
	file      string
	mode      readmodel.Mode
	publisher *Publisher
	runtime   *workspaceRuntime
}

func (w *scriptedAttachedThreadWorkspace) Start(ctx context.Context, _ []protocol.WorkspaceFolder, _ Settings) {
	startColumn, endColumn, useColumn := 14, 26, 8
	generation := uint64(8)
	store := readmodel.NewStore()
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{{
			ID: "thread:shared-conversation", Kind: "thread", Name: "conversation",
			Source: &api.SourceLoc{File: w.file, Line: 3, Column: &startColumn},
			SourceSnippet: &api.SourceSnippet{Range: api.SourceRange{
				File: w.file, StartLine: 3, EndLine: intPointer(3),
				StartColumn: &startColumn, EndColumn: &endColumn,
			}},
		}},
		Findings: []api.IndexLintFinding{{
			ID:     "lint:thread.duplicate_active:thread:shared-conversation",
			RuleID: "thread.duplicate_active", Severity: "error", Category: "runtime",
			Maturity: "stable", Profiles: []string{"recommended", "strict"},
			Title:               "Duplicate active Thread id",
			Message:             `Thread definition "thread:shared-conversation" is active in 2 source locations.`,
			PrimaryDefinitionID: "thread:shared-conversation",
			Source:              &api.SourceLoc{File: w.file, Line: 3, Column: &startColumn},
			DocsURL:             "/docs/reference/crux-core/index-lints/thread-duplicate-active",
		}},
		Relations: []api.ProjectRelation{{
			ID:   "relation:prompt.uses_thread:prompt:answer:thread:shared-conversation",
			Type: "prompt.uses_thread", From: "prompt:answer", To: "thread:shared-conversation",
			Fidelity: "resolved", Source: &api.SourceLoc{File: w.file, Line: 6, Column: &useColumn},
		}},
	})
	w.publisher = NewPublisher(PublisherOptions{
		ScopeID: "scope", Root: w.root, Store: store,
		Notify: func(method string, params any) { w.server.Notify(ctx, method, params) },
	})
	w.mode = readmodel.ModeAttached
	session := &scopeSession{
		scope: readmodel.Scope{ID: "scope", Root: w.root}, publisher: w.publisher,
		mode: w.mode, transient: threadCompletionSource{generation: generation}, sourceEpoch: 1,
	}
	w.runtime = &workspaceRuntime{store: store, sessions: []*scopeSession{session}}
	w.publisher.Change(readmodel.Change{Scope: "scope", Files: []string{w.file}, Immediate: true})
}

func (*scriptedAttachedThreadWorkspace) UpdateSettings(Settings) {}
func (w *scriptedAttachedThreadWorkspace) DidOpen(uri protocol.DocumentURI, version int) {
	w.publisher.DidOpen(uri, version)
}
func (*scriptedAttachedThreadWorkspace) DidChange(protocol.DocumentURI, int, []protocol.TextDocumentContentChangeEvent) {
}
func (*scriptedAttachedThreadWorkspace) DidSave(protocol.DocumentURI)  {}
func (*scriptedAttachedThreadWorkspace) DidClose(protocol.DocumentURI) {}
func (w *scriptedAttachedThreadWorkspace) DisplayedFindings(uri protocol.DocumentURI, position protocol.Position) []displayedFinding {
	return w.publisher.DisplayedFindings(uri, position)
}
func (*scriptedAttachedThreadWorkspace) LeadingWhitespace(protocol.DocumentURI, uint32) (string, bool) {
	return "", true
}
func (w *scriptedAttachedThreadWorkspace) DocumentSymbols(uri protocol.DocumentURI) []protocol.DocumentSymbol {
	return w.runtime.DocumentSymbols(uri)
}
func (w *scriptedAttachedThreadWorkspace) DefinitionLocation(uri protocol.DocumentURI, position protocol.Position) (protocol.Location, bool) {
	return w.runtime.DefinitionLocation(uri, position)
}
func (w *scriptedAttachedThreadWorkspace) HoverAt(uri protocol.DocumentURI, position protocol.Position) ([]displayedFinding, *definitionSummary) {
	return w.runtime.HoverAt(uri, position)
}
func (w *scriptedAttachedThreadWorkspace) Completion(ctx context.Context, uri protocol.DocumentURI, request readmodel.CompletionRequest) completionOutcome {
	return w.runtime.Completion(ctx, uri, request)
}
func (w *scriptedAttachedThreadWorkspace) Close() {
	if w.publisher != nil {
		w.publisher.Close()
	}
}

type threadCompletionSource struct {
	generation uint64
}

func (s threadCompletionSource) Completion(_ context.Context, request readmodel.CompletionRequest) (readmodel.CompletionResult, error) {
	if !strings.Contains(request.Text, "use: [conver]") {
		return readmodel.CompletionResult{}, fmt.Errorf("completion did not receive the unsaved Thread slot")
	}
	return readmodel.CompletionResult{
		DocumentVersion: request.DocumentVersion, Generation: s.generation,
		Items: []readmodel.CompletionItem{{
			ID: "thread:shared-conversation", Kind: "thread", Label: "conversation",
			Detail: "thread · thread:shared-conversation", InsertText: "conversation",
			Replacement: readmodel.CompletionRange{
				Start: readmodel.CompletionPosition{Line: 5, Character: 8},
				End:   readmodel.CompletionPosition{Line: 5, Character: 14},
			},
		}},
	}, nil
}

func (threadCompletionSource) PromptText(context.Context, readmodel.PromptTextRequest) (readmodel.PromptTextResult, error) {
	return readmodel.PromptTextResult{}, nil
}

func assertThreadDiagnostic(t *testing.T, payload []byte, uri string) {
	t.Helper()
	var notification struct {
		Method string                            `json:"method"`
		Params protocol.PublishDiagnosticsParams `json:"params"`
	}
	decodeLSPMessage(t, payload, &notification)
	if notification.Method != protocol.MethodPublishDiagnostics || string(notification.Params.URI) != uri ||
		len(notification.Params.Diagnostics) != 1 || notification.Params.Diagnostics[0].Code != "thread.duplicate_active" ||
		notification.Params.Diagnostics[0].Severity != protocol.SeverityError {
		t.Fatalf("Thread diagnostics = %s", payload)
	}
}

func decodeLSPMessage(t *testing.T, payload []byte, target any) {
	t.Helper()
	if err := json.Unmarshal(payload, target); err != nil {
		t.Fatalf("decode LSP message %s: %v", payload, err)
	}
}

func quotedJSON(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func intPointer(value int) *int { return &value }

func containsThreadDocumentSymbol(symbols []protocol.DocumentSymbol, name string) bool {
	for _, symbol := range symbols {
		if symbol.Name == name && symbol.Detail == "thread" {
			return true
		}
	}
	return false
}
