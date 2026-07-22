package server

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestWorkspaceSymbolHandlerForwardsQueryAndReportsCap(t *testing.T) {
	t.Parallel()

	want := []protocol.SymbolInformation{{Name: "writer", Kind: protocol.SymbolKindFunction}}
	workspace := &workspaceSymbolHandlerWorkspace{symbols: want, capped: true}
	server := New(Options{})
	server.workspace = workspace
	server.settings.Trace = "messages"
	result := server.Handle(context.Background(), protocol.Request{
		ID: []byte("1"), Method: protocol.MethodWorkspaceSymbol, Params: []byte(`{"query":"WRITER"}`),
	})
	got, ok := result.Result.([]protocol.SymbolInformation)
	if result.Error != nil || !ok || len(got) != 1 || got[0].Name != "writer" {
		t.Fatalf("workspace symbols = %#v, error = %#v", result.Result, result.Error)
	}
	if workspace.query != "WRITER" {
		t.Fatalf("workspace query = %q, want WRITER", workspace.query)
	}
	for _, wantMessage := range []string{protocol.MethodWorkspaceSymbol, "workspace/symbol results capped at 200"} {
		notification := <-server.Outbound()
		params := notification.Params.(protocol.LogMessageParams)
		if params.Message != wantMessage {
			t.Fatalf("trace message = %q, want %q", params.Message, wantMessage)
		}
	}
}

func TestWorkspaceSymbolHandlerReturnsEmptyArrayWithoutWorkspace(t *testing.T) {
	t.Parallel()

	result := New(Options{}).Handle(context.Background(), protocol.Request{
		ID: []byte("1"), Method: protocol.MethodWorkspaceSymbol, Params: []byte(`{"query":"none"}`),
	})
	got, ok := result.Result.([]protocol.SymbolInformation)
	if result.Error != nil || !ok || got == nil || len(got) != 0 {
		t.Fatalf("workspace symbol miss = %#v, error = %#v; want []", result.Result, result.Error)
	}
}

func TestWorkspaceSymbolHandlerRequiresAStringQuery(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	for _, raw := range []string{"null", `{}`, `{"query":null}`, `{"query":7}`} {
		result := server.Handle(context.Background(), protocol.Request{
			ID: []byte("1"), Method: protocol.MethodWorkspaceSymbol, Params: []byte(raw),
		})
		if result.Error == nil || result.Error.Code != protocol.InvalidParamsCode {
			t.Errorf("params %s result = %#v, want InvalidParams", raw, result)
		}
	}
	workspace := &workspaceSymbolHandlerWorkspace{}
	server.workspace = workspace
	result := server.Handle(context.Background(), protocol.Request{
		ID: []byte("2"), Method: protocol.MethodWorkspaceSymbol, Params: []byte(`{"query":""}`),
	})
	if result.Error != nil || workspace.query != "" {
		t.Fatalf("empty query result = %#v, forwarded query = %q", result, workspace.query)
	}
}

func TestWorkspaceSymbolsFilterSortCapAndPreserveScopeNames(t *testing.T) {
	t.Parallel()

	parent := t.TempDir()
	rootA, rootB := filepath.Join(parent, "a"), filepath.Join(parent, "b")
	fileA := workspaceSymbolFile(t, rootA)
	fileB := workspaceSymbolFile(t, rootB)
	definitionsA := workspaceSymbolDefinitions(fileA, "a", 100)
	definitionsB := workspaceSymbolDefinitions(fileB, "b", 100)
	definitionsA[0].ID, definitionsB[0].ID = "prompt:duplicate", "prompt:duplicate"
	definitionsA[0].Name, definitionsB[0].Name = "keep-duplicate-a", "keep-duplicate-b"
	overflow := navigationTestDefinition("prompt:000-early", fileB, 1, nil, nil)
	overflow.Name = "early-appended"
	definitionsB = append(definitionsB, overflow)

	publisherA := navigationTestPublisher(t, "scope-a", rootA, readmodel.Snapshot{Definitions: definitionsA})
	publisherB := navigationTestPublisher(t, "scope-b", rootB, readmodel.Snapshot{Definitions: definitionsB})
	workspace := &workspaceRuntime{sessions: []*scopeSession{
		{scope: readmodel.Scope{ID: "scope-b", Root: rootB}, folderName: "Frontend", publisher: publisherB},
		{scope: readmodel.Scope{ID: "scope-a", Root: rootA}, folderName: "Backend", publisher: publisherA},
	}}

	exact, capped := workspace.WorkspaceSymbols("KeEp")
	if capped || len(exact) != 200 {
		t.Fatalf("200 matching symbols = %d, capped = %v", len(exact), capped)
	}
	all, capped := workspace.WorkspaceSymbols("")
	if !capped || len(all) != 200 {
		t.Fatalf("201 symbols capped result = %d, capped = %v", len(all), capped)
	}
	if all[0].ContainerName != "Backend" || all[100].ContainerName != "Frontend" {
		t.Fatalf("container names around scope boundary = %q, %q", all[0].ContainerName, all[100].ContainerName)
	}
	if !workspaceSymbolsContain(all, "early-appended") || workspaceSymbolsContain(all, "keep-b-099") {
		t.Fatalf("globally sorted cap did not retain early appended/drop late result")
	}
	duplicates, capped := workspace.WorkspaceSymbols("PrOmPt:DuPlIcAtE")
	if capped || len(duplicates) != 2 || duplicates[0].ContainerName == duplicates[1].ContainerName {
		t.Fatalf("duplicate IDs across scopes = %#v, capped = %v", duplicates, capped)
	}
	if single, capped := workspace.WorkspaceSymbols("KEEP-A-099"); capped || len(single) != 1 {
		t.Fatalf("case-insensitive name result = %#v, capped = %v", single, capped)
	}
	if missing, capped := workspace.WorkspaceSymbols("does-not-exist"); capped || missing == nil || len(missing) != 0 {
		t.Fatalf("missing symbols = %#v, capped = %v; want []", missing, capped)
	}
}

func workspaceSymbolsContain(symbols []protocol.SymbolInformation, name string) bool {
	for _, symbol := range symbols {
		if symbol.Name == name {
			return true
		}
	}
	return false
}

func TestWorkspaceSymbolKindMapping(t *testing.T) {
	t.Parallel()

	tests := map[string]protocol.SymbolKind{
		"prompt": protocol.SymbolKindFunction, "context": protocol.SymbolKindObject,
		"tool": protocol.SymbolKindMethod, "agent": protocol.SymbolKindClass,
		"flow": protocol.SymbolKindEvent, "eval": protocol.SymbolKindInterface,
		"router": protocol.SymbolKindOperator, "cascade": protocol.SymbolKindOperator,
		"fallback": protocol.SymbolKindOperator, "unknown": protocol.SymbolKindObject,
	}
	for kind, want := range tests {
		if got := symbolKind(kind); got != want {
			t.Errorf("symbolKind(%q) = %d, want %d", kind, got, want)
		}
	}
}

func TestWorkspaceFolderNamePreservesInitializeNameAndFallsBack(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	folders := []protocol.WorkspaceFolder{{URI: protocol.DocumentURI("file://" + filepath.ToSlash(root)), Name: "API workspace"}}
	if got := workspaceFolderName(root, folders); got != "API workspace" {
		t.Fatalf("workspace folder name = %q", got)
	}
	folders[0].Name = ""
	if got := workspaceFolderName(root, folders); got != filepath.Base(root) {
		t.Fatalf("empty workspace folder name fallback = %q", got)
	}
}

type workspaceSymbolHandlerWorkspace struct {
	workspaceController
	query   string
	symbols []protocol.SymbolInformation
	capped  bool
}

func (w *workspaceSymbolHandlerWorkspace) WorkspaceSymbols(query string) ([]protocol.SymbolInformation, bool) {
	w.query = query
	return w.symbols, w.capped
}

func workspaceSymbolFile(t *testing.T, root string) string {
	t.Helper()
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	return navigationTestFile(t, root, "symbols.ts", strings.Repeat("symbol\n", 4))
}

func workspaceSymbolDefinitions(file, prefix string, count int) []api.ProjectDefinition {
	definitions := make([]api.ProjectDefinition, count)
	for index := range definitions {
		id := fmt.Sprintf("prompt:keep-%s-%03d", prefix, index)
		definitions[index] = navigationTestDefinition(id, file, 1, nil, nil)
		definitions[index].Name = fmt.Sprintf("keep-%s-%03d", prefix, index)
	}
	return definitions
}
