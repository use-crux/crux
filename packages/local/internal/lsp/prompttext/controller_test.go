package prompttext

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestControllerDecoratesOneHeadingForExactCanonicalIdentity(t *testing.T) {
	t.Parallel()

	golden := readPromptTextControllerGolden(t)
	source := golden.Request.Query.Source
	file := golden.Request.Query.File
	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	document := transient.Document{
		URI: uri, LanguageID: "typescript", Version: 11, Text: source,
		Revision: golden.Request.Query.Revision,
	}
	sourceRange := api.SourceRange{
		File: file, StartLine: 4, StartColumn: intPointer(11),
		EndLine: intPointer(4), EndColumn: intPointer(22),
	}
	generation := uint64(4)
	store := readmodel.NewStore()
	store.ApplySnapshot("/repo", readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{{
			ID: "prompt:writer",
			SourceRefs: []api.ProjectSourceRef{{
				ID:     "prompt:writer:source:prompt:prompt-text",
				Source: api.SourceLoc{File: file, Line: 4, Column: intPointer(11)},
				Snippet: &api.SourceSnippet{
					Source: "md`# Hello`", Language: "typescript", Range: sourceRange,
				},
				Fidelity: "resolved",
				Metadata: map[string]any{"promptText": map[string]any{
					"tag": "md", "language": "markdown", "lifecycle": "static",
				}},
			}},
		}},
		Sources: []api.IndexSourceFile{{
			File: file, Status: "indexed", SourceHash: document.Revision.SourceHash,
		}},
	})
	views := indexview.NewSavedProvider(store)
	analyzer := fixedTransientSource{result: golden.Response.Response}
	documents := &fixedDocumentSource{document: document}
	controller := NewController(documents)

	result := controller.Decorations(context.Background(), Request{
		URI: uri, File: file, Root: "/repo", ScopeID: "/repo",
		SourceEpoch: 3, Analyzer: analyzer, Views: views,
	})
	if result.Revision != document.Revision || len(result.Decorations) != 1 {
		t.Fatalf("decorations = %#v, want exact revision and one heading", result)
	}
	decoration := result.Decorations[0]
	if decoration.Role != DecorationRoleHeading ||
		decoration.Range != (protocol.Range{
			Start: protocol.Position{Line: 3, Character: 15},
			End:   protocol.Position{Line: 3, Character: 20},
		}) {
		t.Fatalf("decoration = %#v, want heading text range", decoration)
	}
}

func TestControllerRejectsLocalSameNameWithoutSemanticSourceRef(t *testing.T) {
	t.Parallel()

	const (
		file   = "/repo/src/impostor.ts"
		source = "const md = String.raw\nconst value = md`# Impostor`\n"
	)
	uri := protocol.DocumentURI("file:///repo/src/impostor.ts")
	document := transient.Document{
		URI: uri, LanguageID: "typescript", Version: 1, Text: source,
		Revision: transient.NewRevision(1, 1, source),
	}
	generation := uint64(4)
	store := readmodel.NewStore()
	store.ApplySnapshot("/repo", readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{{
			ID: "prompt:impostor",
			// The semantic backend emits no PromptText source ref for a local
			// or shadowed same-name tag.
		}},
		Sources: []api.IndexSourceFile{{
			File: file, Status: "indexed", SourceHash: document.Revision.SourceHash,
		}},
	})
	controller := NewController(&fixedDocumentSource{document: document})
	result := controller.Decorations(context.Background(), Request{
		URI: uri, File: file, Root: "/repo", ScopeID: "/repo",
		SourceEpoch: 1,
		Analyzer:    panicTransientSource{},
		Views:       indexview.NewSavedProvider(store),
	})
	if result.Revision != document.Revision || result.Decorations == nil ||
		len(result.Decorations) != 0 {
		t.Fatalf("name-only result = %#v, want exact clear without analysis", result)
	}
	symbols := controller.Symbols(context.Background(), Request{
		URI: uri, File: file, Root: "/repo", ScopeID: "/repo",
		SourceEpoch: 1,
		Analyzer:    panicTransientSource{},
		Views:       indexview.NewSavedProvider(store),
	})
	if symbols.Revision != document.Revision || symbols.Symbols == nil ||
		len(symbols.Symbols) != 0 {
		t.Fatalf("name-only symbols = %#v, want exact empty without analysis", symbols)
	}
}

func intPointer(value int) *int { return &value }

type promptTextControllerGolden struct {
	Request  staticprotocol.PromptTextWorkerRequest                                `json:"request"`
	Response staticprotocol.WorkerResponse[staticprotocol.PromptTextQueryResponse] `json:"response"`
}

func readPromptTextControllerGolden(t *testing.T) promptTextControllerGolden {
	t.Helper()

	_, caller, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve PromptText controller fixture caller")
	}
	data, err := os.ReadFile(filepath.Join(
		filepath.Dir(caller),
		"../../../../indexer/src/contracts/fixtures/prompt-text-query-v1.json",
	))
	if err != nil {
		t.Fatal(err)
	}
	var fixture promptTextControllerGolden
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture
}

type fixedDocumentSource struct {
	document transient.Document
}

func (s *fixedDocumentSource) Snapshot(uri protocol.DocumentURI) (transient.Document, bool) {
	return s.document, s.document.URI == uri
}

type fixedTransientSource struct {
	result readmodel.PromptTextResult
}

type panicTransientSource struct{}

func (panicTransientSource) Completion(
	context.Context,
	readmodel.CompletionRequest,
) (readmodel.CompletionResult, error) {
	panic("name-only identity reached transient completion")
}

func (panicTransientSource) PromptText(
	context.Context,
	readmodel.PromptTextRequest,
) (readmodel.PromptTextResult, error) {
	panic("name-only identity reached transient PromptText analysis")
}

func (fixedTransientSource) Completion(
	context.Context,
	readmodel.CompletionRequest,
) (readmodel.CompletionResult, error) {
	return readmodel.CompletionResult{}, nil
}

func (s fixedTransientSource) PromptText(
	context.Context,
	readmodel.PromptTextRequest,
) (readmodel.PromptTextResult, error) {
	return s.result, nil
}
