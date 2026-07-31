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
	indexcompletion "github.com/use-crux/crux/packages/local/internal/projectindex/completion"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestEffectFixtureInheritsGenericLSPFeatures(t *testing.T) {
	root, err := filepath.Abs(filepath.Join("..", "..", "..", "..", "indexer", "fixtures", "effect-static-project"))
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "effects.ts")
	source, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}

	editor := New(Options{Version: "effect-test", ClientRequestTimeout: time.Second})
	workspace := &effectSessionWorkspace{
		server: editor, root: root, file: file, compiler: &effectSessionCompiler{},
	}
	editor.workspace = workspace
	input, inputWriter := io.Pipe()
	outputReader, outputWriter := io.Pipe()
	done := make(chan error, 1)
	go func() {
		done <- jsonrpc.Serve(context.Background(), input, outputWriter, io.Discard, editor)
	}()
	writer, reader := jsonrpc.NewWriter(inputWriter), jsonrpc.NewReader(outputReader)

	writeMessage(t, writer, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{`+
		`"rootUri":"file://`+filepath.ToSlash(root)+`",`+
		`"initializationOptions":{"workspaceTrust":true},`+
		`"capabilities":{"textDocument":{"hover":{"contentFormat":["markdown"]}}}}}`)
	readMessage(t, reader)
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"initialized"}`)
	diagnosticMessage := readEffectSessionMessage(t, reader)
	if diagnosticMessage.Method != protocol.MethodPublishDiagnostics {
		t.Fatalf("initialized notification = %q, want %q", diagnosticMessage.Method, protocol.MethodPublishDiagnostics)
	}
	var published protocol.PublishDiagnosticsParams
	if err := json.Unmarshal(diagnosticMessage.Params, &published); err != nil {
		t.Fatal(err)
	}
	wantDiagnosticRange := protocol.Range{
		Start: protocol.Position{Line: 6, Character: 29},
		End:   protocol.Position{Line: 10, Character: 2},
	}
	if len(published.Diagnostics) != 1 ||
		published.Diagnostics[0].Code != "effect.duplicate_identity" ||
		published.Diagnostics[0].Range != wantDiagnosticRange {
		t.Fatalf("effect diagnostics = %+v, want duplicate identity at %+v", published.Diagnostics, wantDiagnosticRange)
	}

	uri := "file://" + filepath.ToSlash(file)
	dirtySource := string(source)
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":{`+
		`"uri":"`+uri+`","languageId":"typescript","version":1,"text":`+
		string(mustJSON(t, dirtySource))+`}}}`)
	readEffectSessionMessage(t, reader)

	writeMessage(t, writer, `{"jsonrpc":"2.0","id":2,"method":"textDocument/hover","params":{`+
		`"textDocument":{"uri":"`+uri+`"},"position":{"line":4,"character":40}}}`)
	hoverResponse := readEffectSessionMessage(t, reader)
	var hover protocol.Hover
	if err := json.Unmarshal(hoverResponse.Result, &hover); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(hover.Contents.Value, "**inventory.reserve** — effect") {
		t.Fatalf("effect hover = %q, want generic identity and kind", hover.Contents.Value)
	}

	writeMessage(t, writer, `{"jsonrpc":"2.0","id":3,"method":"textDocument/hover","params":{`+
		`"textDocument":{"uri":"`+uri+`"},"position":{"line":6,"character":40}}}`)
	findingHoverResponse := readEffectSessionMessage(t, reader)
	var findingHover protocol.Hover
	if err := json.Unmarshal(findingHoverResponse.Result, &findingHover); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(findingHover.Contents.Value, "Effect identity is defined more than once") ||
		!strings.Contains(findingHover.Contents.Value, "`effect.duplicate_identity`") ||
		!strings.Contains(findingHover.Contents.Value, "**payments.charge** — effect") {
		t.Fatalf("effect finding hover = %q, want finding context and generic definition", findingHover.Contents.Value)
	}

	consumerFile := filepath.Join(root, "consumer.ts")
	consumerURI := "file://" + filepath.ToSlash(consumerFile)
	consumerSource := "const selectedEffect = chargePay"
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":{`+
		`"uri":"`+consumerURI+`","languageId":"typescript","version":1,"text":`+
		string(mustJSON(t, consumerSource))+`}}}`)
	readEffectSessionMessage(t, reader)

	writeMessage(t, writer, `{"jsonrpc":"2.0","id":4,"method":"textDocument/completion","params":{`+
		`"textDocument":{"uri":"`+consumerURI+`"},"position":{"line":0,"character":32}}}`)
	completionResponse := readEffectSessionMessage(t, reader)
	var completion protocol.CompletionList
	if err := json.Unmarshal(completionResponse.Result, &completion); err != nil {
		t.Fatal(err)
	}
	if len(completion.Items) != 1 || completion.Items[0].Label != "chargePayment" ||
		completion.Items[0].Detail != "effect · effect:payments.charge:v2" {
		t.Fatalf("effect completion = %+v, want generic Effect reference item", completion)
	}
	if got := workspace.compiler.query.Candidates; len(got) != 2 ||
		got[0].ID != "effect:inventory.reserve:v1" ||
		got[0].Binding != "reserveInventory" || got[0].File != file ||
		got[1].ID != "effect:payments.charge:v2" ||
		got[1].Binding != "chargePayment" || got[1].File != file {
		t.Fatalf("effect completion candidates = %+v, want exported cross-file Effects only", got)
	}

	writeMessage(t, writer, `{"jsonrpc":"2.0","id":5,"method":"shutdown"}`)
	readMessage(t, reader)
	writeMessage(t, writer, `{"jsonrpc":"2.0","method":"exit"}`)
	_ = inputWriter.Close()
	_ = outputReader.Close()
	select {
	case err := <-done:
		if err != nil && err != io.ErrClosedPipe {
			t.Fatalf("serve effect session: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("effect LSP session did not exit")
	}
}

type effectSessionWorkspace struct {
	workspaceController
	server      *Server
	root        string
	file        string
	publisher   *Publisher
	definitions []api.ProjectDefinition
	compiler    *effectSessionCompiler
}

func (w *effectSessionWorkspace) Start(ctx context.Context, _ []protocol.WorkspaceFolder, _ Settings) {
	reserveEndLine, reserveStartColumn, reserveEndColumn := 5, 33, 69
	chargeEndLine, chargeStartColumn, chargeEndColumn := 11, 30, 3
	reserve := api.ProjectDefinition{
		ID: "effect:inventory.reserve:v1", Kind: "effect", Name: "inventory.reserve",
		Metadata: json.RawMessage(`{"exportName":"reserveInventory","exported":true}`),
		Source:   &api.SourceLoc{File: w.file, Line: 5, Column: &reserveStartColumn},
		SourceSnippet: &api.SourceSnippet{
			Source: `effect("inventory.reserve", execute)`,
			Range: api.SourceRange{
				File: w.file, StartLine: 5, EndLine: &reserveEndLine,
				StartColumn: &reserveStartColumn, EndColumn: &reserveEndColumn,
			},
		},
	}
	charge := api.ProjectDefinition{
		ID: "effect:payments.charge:v2", Kind: "effect", Name: "payments.charge",
		Metadata: json.RawMessage(`{"exportName":"chargePayment","exported":true}`),
		Source:   &api.SourceLoc{File: w.file, Line: 7, Column: &chargeStartColumn},
		SourceSnippet: &api.SourceSnippet{
			Source: "effect(\"payments.charge\", execute, {\n  version: 2,\n  resource: (input) => ({ type: \"payment\", id: input.id }),\n  recover: async () => undefined,\n})",
			Range: api.SourceRange{
				File: w.file, StartLine: 7, EndLine: &chargeEndLine,
				StartColumn: &chargeStartColumn, EndColumn: &chargeEndColumn,
			},
		},
	}
	finding := api.IndexLintFinding{
		ID:     "lint:effect.duplicate_identity:effect:payments.charge:v2",
		RuleID: "effect.duplicate_identity", Severity: "error", Maturity: "preview",
		Profiles: []string{"recommended", "strict"}, Title: "Effect identity is defined more than once",
		Message:             `Effect identity "payments.charge" version 2 is declared at 2 call sites.`,
		Source:              &api.SourceLoc{File: w.file, Line: 7, Column: &chargeStartColumn},
		PrimaryDefinitionID: charge.ID,
	}
	private := api.ProjectDefinition{
		ID: "effect:private:v1", Kind: "effect", Name: "private",
		Metadata: json.RawMessage(`{"exportName":"privateEffect"}`),
		Source:   &api.SourceLoc{File: w.file, Line: 29},
	}
	store := readmodel.NewStore()
	w.definitions = []api.ProjectDefinition{reserve, charge, private}
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Definitions: w.definitions,
		Findings:    []api.IndexLintFinding{finding},
	})
	w.publisher = NewPublisher(PublisherOptions{
		ScopeID: "scope", Root: w.root, Store: store,
		Notify: func(method string, params any) { w.server.Notify(ctx, method, params) },
	})
	w.publisher.Change(readmodel.Change{Scope: "scope", Files: []string{w.file}, Immediate: true})
}

func (w *effectSessionWorkspace) UpdateSettings(Settings) {}
func (w *effectSessionWorkspace) DidOpen(uri protocol.DocumentURI, version int) {
	w.publisher.DidOpen(uri, version)
}
func (w *effectSessionWorkspace) DidChange(uri protocol.DocumentURI, version int, changes []protocol.TextDocumentContentChangeEvent) {
	w.publisher.DidChange(uri, version, changes)
}
func (w *effectSessionWorkspace) DidSave(uri protocol.DocumentURI)  { w.publisher.DidSave(uri) }
func (w *effectSessionWorkspace) DidClose(uri protocol.DocumentURI) { w.publisher.DidClose(uri) }
func (w *effectSessionWorkspace) DisplayedFindings(uri protocol.DocumentURI, position protocol.Position) []displayedFinding {
	return w.publisher.DisplayedFindings(uri, position)
}
func (w *effectSessionWorkspace) HoverAt(uri protocol.DocumentURI, position protocol.Position) ([]displayedFinding, *definitionSummary) {
	return w.publisher.HoverAt(uri, position)
}
func (w *effectSessionWorkspace) Completion(
	ctx context.Context,
	_ protocol.DocumentURI,
	request readmodel.CompletionRequest,
) completionOutcome {
	result, err := indexcompletion.New(w.compiler).Complete(
		ctx,
		indexcompletion.View{ProjectRoot: w.root, Generation: 17, Definitions: w.definitions},
		indexcompletion.Request{
			File: request.File, DocumentVersion: request.DocumentVersion,
			LanguageID: request.LanguageID, Text: request.Text,
			Position: request.Position, Limit: request.Limit,
		},
	)
	if err != nil {
		return completionOutcome{Kind: completionOutcomeSoft}
	}
	return completionOutcome{Kind: completionOutcomeCurrent, Result: readmodel.CompletionResult(result)}
}
func (w *effectSessionWorkspace) LeadingWhitespace(protocol.DocumentURI, uint32) (string, bool) {
	return "", true
}
func (w *effectSessionWorkspace) Close() {
	if w.publisher != nil {
		w.publisher.Close()
	}
}

type effectSessionCompiler struct {
	query staticprotocol.CompletionQuery
}

func (c *effectSessionCompiler) Completion(
	_ context.Context,
	query staticprotocol.CompletionQuery,
) (staticprotocol.CompletionResponse, error) {
	c.query = query
	for _, candidate := range query.Candidates {
		if candidate.ID != "effect:payments.charge:v2" {
			continue
		}
		return staticprotocol.CompletionResponse{Items: []staticprotocol.CompletionItem{{
			ID: candidate.ID, Kind: candidate.Kind, Label: candidate.Binding,
			Detail: "effect · " + candidate.ID, InsertText: candidate.Binding,
			Replacement: staticprotocol.CompletionRange{
				Start: staticprotocol.CompletionPosition{Character: 23},
				End:   staticprotocol.CompletionPosition{Character: 32},
			},
		}}}, nil
	}
	return staticprotocol.CompletionResponse{}, nil
}

type effectSessionMessage struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
	Result json.RawMessage `json:"result"`
}

func readEffectSessionMessage(t *testing.T, reader *jsonrpc.Reader) effectSessionMessage {
	t.Helper()
	var message effectSessionMessage
	if err := json.Unmarshal(readMessage(t, reader), &message); err != nil {
		t.Fatal(err)
	}
	return message
}

func mustJSON(t *testing.T, value string) []byte {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}
