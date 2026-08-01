package server

import (
	"context"
	"encoding/json"
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

func TestScriptedAttachedKnowledgeNavigationAndHover(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "src", "knowledge.ts")
	source := strings.Join([]string{
		`import { knowledgeBase, relate, assertions } from "@use-crux/core/knowledge";`,
		`export const docs = knowledgeBase({ id: "docs" });`,
		`export const citations = relate({`,
		`  id: "citations",`,
		`  version: 3,`,
		`  types: { cites: { from: ["chunk"], to: ["document"], direction: "directed", description: "Cites" } },`,
		`  run: () => {},`,
		`});`,
		`export const claims = assertions({ id: "claims", version: 2, types: { risk: z.object({}) }, run: () => {} });`,
		`export const recipe = docs.recipe({ steps: [expandRelations({ types: ["cites"] })] });`,
	}, "\n")

	server := New(Options{Version: "0.7.0-test"})
	workspace := &scriptedAttachedKnowledgeWorkspace{server: server, root: root, file: file}
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
	assertKnowledgeDiagnostic(t, readMessage(t, reader), uri)

	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":{`+
		`"uri":"`+uri+`","languageId":"typescript","version":1,"text":`+quotedJSON(source)+`}}}`)
	assertKnowledgeDiagnostic(t, readMessage(t, reader), uri)

	writeMessage(t, writer, `{"jsonrpc":"2.0","id":2,"method":"textDocument/definition","params":{`+
		`"textDocument":{"uri":"`+uri+`"},"position":{"line":9,"character":54}}}`)
	var definitionResponse struct {
		Result *protocol.Location `json:"result"`
	}
	decodeLSPMessage(t, readMessage(t, reader), &definitionResponse)
	if definitionResponse.Result == nil || string(definitionResponse.Result.URI) != uri ||
		definitionResponse.Result.Range.Start.Line != 2 {
		t.Fatalf("Knowledge definition navigation = %+v", definitionResponse.Result)
	}

	writeMessage(t, writer, `{"jsonrpc":"2.0","id":3,"method":"textDocument/hover","params":{`+
		`"textDocument":{"uri":"`+uri+`"},"position":{"line":2,"character":20}}}`)
	var hoverResponse struct {
		Result protocol.Hover `json:"result"`
	}
	decodeLSPMessage(t, readMessage(t, reader), &hoverResponse)
	for _, want := range []string{
		"**citations** — knowledge.relation",
		"kind knowledge.relation",
		"id knowledge.relation:citations",
		"version 3",
		"types cites, supports",
	} {
		if !strings.Contains(hoverResponse.Result.Contents.Value, want) {
			t.Fatalf("Knowledge hover missing %q: %q", want, hoverResponse.Result.Contents.Value)
		}
	}
	if workspace.mode != readmodel.ModeAttached {
		t.Fatalf("workspace mode = %q, want ATTACHED", workspace.mode)
	}

	writeMessage(t, writer, `{"jsonrpc":"2.0","id":4,"method":"shutdown"}`)
	readMessage(t, reader)
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"exit"}`)
	_ = inputWriter.Close()
	_ = outputReader.Close()
	select {
	case err := <-done:
		if err != nil && err != io.ErrClosedPipe {
			t.Fatalf("serve Knowledge session: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("scripted Knowledge session did not exit")
	}
}

type scriptedAttachedKnowledgeWorkspace struct {
	workspaceController
	server    *Server
	root      string
	file      string
	mode      readmodel.Mode
	publisher *Publisher
	runtime   *workspaceRuntime
}

func (w *scriptedAttachedKnowledgeWorkspace) Start(ctx context.Context, _ []protocol.WorkspaceFolder, _ Settings) {
	definitionStart, definitionEnd, useColumn := 14, 23, 54
	generation := uint64(9)
	store := readmodel.NewStore()
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{{
			ID: "knowledge.relation:citations", Kind: "knowledge.relation", Name: "citations",
			Source: &api.SourceLoc{File: w.file, Line: 3, Column: &definitionStart},
			SourceSnippet: &api.SourceSnippet{Range: api.SourceRange{
				File: w.file, StartLine: 3, EndLine: intPointer(8),
				StartColumn: &definitionStart, EndColumn: &definitionEnd,
			}},
			Fidelity: "resolved",
			Metadata: json.RawMessage(`{"facts":{"kind":"knowledge.relation","relationId":"citations","version":3,"typeNames":["cites","supports"]}}`),
		}, {
			ID: "knowledge.assertions:claims", Kind: "knowledge.assertions", Name: "claims",
			Source:   &api.SourceLoc{File: w.file, Line: 9},
			Fidelity: "resolved",
			Metadata: json.RawMessage(`{"facts":{"kind":"knowledge.assertions","assertionId":"claims","version":2,"typeNames":["risk"]}}`),
		}},
		Findings: []api.IndexLintFinding{{
			ID:     "lint:assertions-unknown-type-selection:knowledge.assertions:claims:status",
			RuleID: "assertions-unknown-type-selection", Severity: "warning", Category: "contracts",
			Maturity: "stable", Confidence: "high", Profiles: []string{"recommended", "strict"},
			Title:               "Assertion selection names an unknown type",
			Message:             `Assertion selection for "claims" names unknown type "status"; declared assertion types: "risk".`,
			PrimaryDefinitionID: "knowledge.assertions:claims",
			Source:              &api.SourceLoc{File: w.file, Line: 9},
			DocsURL:             "/docs/reference/crux-core/index-lints/assertions-unknown-type-selection",
		}},
		Relations: []api.ProjectRelation{{
			ID:   "relation:knowledge.recipe.expands:rag.recipe:docs:knowledge.relation:citations",
			Type: "knowledge.recipe.expands_relation", From: "rag.recipe:docs", To: "knowledge.relation:citations",
			Fidelity: "resolved", Source: &api.SourceLoc{File: w.file, Line: 10, Column: &useColumn},
		}},
	})
	w.publisher = NewPublisher(PublisherOptions{
		ScopeID: "scope", Root: w.root, Store: store,
		Notify: func(method string, params any) { w.server.Notify(ctx, method, params) },
	})
	w.mode = readmodel.ModeAttached
	session := &scopeSession{
		scope: readmodel.Scope{ID: "scope", Root: w.root}, publisher: w.publisher,
		mode: w.mode, sourceEpoch: 1,
	}
	w.runtime = &workspaceRuntime{store: store, sessions: []*scopeSession{session}}
	w.publisher.Change(readmodel.Change{Scope: "scope", Files: []string{w.file}, Immediate: true})
}

func (*scriptedAttachedKnowledgeWorkspace) UpdateSettings(Settings) {}
func (w *scriptedAttachedKnowledgeWorkspace) DidOpen(uri protocol.DocumentURI, version int) {
	w.publisher.DidOpen(uri, version)
}
func (*scriptedAttachedKnowledgeWorkspace) DidChange(protocol.DocumentURI, int, []protocol.TextDocumentContentChangeEvent) {
}
func (*scriptedAttachedKnowledgeWorkspace) DidSave(protocol.DocumentURI)  {}
func (*scriptedAttachedKnowledgeWorkspace) DidClose(protocol.DocumentURI) {}
func (w *scriptedAttachedKnowledgeWorkspace) DisplayedFindings(uri protocol.DocumentURI, position protocol.Position) []displayedFinding {
	return w.publisher.DisplayedFindings(uri, position)
}
func (*scriptedAttachedKnowledgeWorkspace) LeadingWhitespace(protocol.DocumentURI, uint32) (string, bool) {
	return "", true
}
func (w *scriptedAttachedKnowledgeWorkspace) DocumentSymbols(uri protocol.DocumentURI) []protocol.DocumentSymbol {
	return w.runtime.DocumentSymbols(uri)
}
func (w *scriptedAttachedKnowledgeWorkspace) DefinitionLocation(uri protocol.DocumentURI, position protocol.Position) (protocol.Location, bool) {
	return w.runtime.DefinitionLocation(uri, position)
}
func (w *scriptedAttachedKnowledgeWorkspace) HoverAt(uri protocol.DocumentURI, position protocol.Position) ([]displayedFinding, *definitionSummary) {
	return w.runtime.HoverAt(uri, position)
}
func (w *scriptedAttachedKnowledgeWorkspace) Close() {
	if w.publisher != nil {
		w.publisher.Close()
	}
}

func assertKnowledgeDiagnostic(t *testing.T, payload []byte, uri string) {
	t.Helper()
	var notification struct {
		Method string                            `json:"method"`
		Params protocol.PublishDiagnosticsParams `json:"params"`
	}
	decodeLSPMessage(t, payload, &notification)
	if notification.Method != protocol.MethodPublishDiagnostics || string(notification.Params.URI) != uri ||
		len(notification.Params.Diagnostics) != 1 || notification.Params.Diagnostics[0].Code != "assertions-unknown-type-selection" ||
		notification.Params.Diagnostics[0].Severity != protocol.SeverityWarning {
		t.Fatalf("Knowledge diagnostics = %s", payload)
	}
}
