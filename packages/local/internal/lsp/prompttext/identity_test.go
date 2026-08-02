package prompttext

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestControllerAcceptsAliasedCanonicalSemanticRef(t *testing.T) {
	t.Parallel()

	document, file, sourceRef, analysis := aliasedIdentityFixture()
	controller := NewController(&fixedDocumentSource{document: document})

	request := Request{
		URI: document.URI, File: file, Root: "/repo", ScopeID: "/repo",
		SourceEpoch: 1, Analyzer: fixedTransientSource{result: analysis},
		Views: semanticIdentityProvider(document, file, sourceRef),
	}
	result := controller.Decorations(context.Background(), request)

	if len(result.Decorations) != 1 ||
		result.Decorations[0] != (Decoration{
			Role: DecorationRoleHeading,
			Range: protocol.Range{
				Start: protocol.Position{Line: 0, Character: 21},
				End:   protocol.Position{Line: 0, Character: 26},
			},
		}) {
		t.Fatalf("aliased canonical decorations = %#v, want one heading", result)
	}
	symbols := controller.Symbols(context.Background(), request)
	if len(symbols.Symbols) != 1 || symbols.Symbols[0].Name != "Alias" {
		t.Fatalf("aliased canonical symbols = %#v, want Rust-labelled heading", symbols)
	}
}

func TestControllerDecoratesCanonicalDynamicSemanticRef(t *testing.T) {
	t.Parallel()

	document, file, sourceRef, analysis := aliasedIdentityFixture()
	sourceRef.Metadata["promptText"].(map[string]any)["lifecycle"] = "dynamic"
	controller := NewController(&fixedDocumentSource{document: document})

	result := controller.Decorations(context.Background(), Request{
		URI: document.URI, File: file, Root: "/repo", ScopeID: "/repo",
		SourceEpoch: 1, Analyzer: fixedTransientSource{result: analysis},
		Views: semanticIdentityProvider(document, file, sourceRef),
	})

	if len(result.Decorations) != 1 ||
		result.Decorations[0].Role != DecorationRoleHeading {
		t.Fatalf("dynamic canonical decorations = %#v, want one heading", result)
	}

	symbols := controller.Symbols(context.Background(), Request{
		URI: document.URI, File: file, Root: "/repo", ScopeID: "/repo",
		SourceEpoch: 1, Analyzer: fixedTransientSource{result: analysis},
		Views: semanticIdentityProvider(document, file, sourceRef),
	})
	if len(symbols.Symbols) != 1 || symbols.Symbols[0].Name != "Alias" {
		t.Fatalf("dynamic canonical symbols = %#v, want Rust-labelled heading", symbols)
	}
}

func TestControllerRejectsForeignNormalizedPromptTextTag(t *testing.T) {
	t.Parallel()

	document, file, sourceRef, analysis := aliasedIdentityFixture()
	sourceRef.Metadata["promptText"].(map[string]any)["tag"] = "lookalike"
	controller := NewController(&fixedDocumentSource{document: document})

	result := controller.Decorations(context.Background(), Request{
		URI: document.URI, File: file, Root: "/repo", ScopeID: "/repo",
		SourceEpoch: 1, Analyzer: fixedTransientSource{result: analysis},
		Views: semanticIdentityProvider(document, file, sourceRef),
	})

	if result.Decorations == nil || len(result.Decorations) != 0 {
		t.Fatalf("foreign normalized tag decorations = %#v, want exact clear", result)
	}
}

func TestControllerRejectsForeignPromptTextLifecycle(t *testing.T) {
	t.Parallel()

	document, file, sourceRef, _ := aliasedIdentityFixture()
	sourceRef.Metadata["promptText"].(map[string]any)["lifecycle"] = "eventual"
	controller := NewController(&fixedDocumentSource{document: document})

	result := controller.Decorations(context.Background(), Request{
		URI: document.URI, File: file, Root: "/repo", ScopeID: "/repo",
		SourceEpoch: 1, Analyzer: panicTransientSource{},
		Views: semanticIdentityProvider(document, file, sourceRef),
	})
	if result.Decorations == nil || len(result.Decorations) != 0 {
		t.Fatalf("foreign lifecycle decorations = %#v, want exact clear", result)
	}
}

func TestControllerMatchesSemanticSourceColumnsAsUTF16(t *testing.T) {
	t.Parallel()

	document, file, sourceRef, analysis := unicodeIdentityFixture()
	controller := NewController(&fixedDocumentSource{document: document})

	request := Request{
		URI: document.URI, File: file, Root: "/repo", ScopeID: "/repo",
		SourceEpoch: 1, Analyzer: fixedTransientSource{result: analysis},
		Views: semanticIdentityProvider(document, file, sourceRef),
	}
	result := controller.Decorations(context.Background(), request)

	if len(result.Decorations) != 1 ||
		result.Decorations[0] != (Decoration{
			Role: DecorationRoleHeading,
			Range: protocol.Range{
				Start: protocol.Position{Line: 0, Character: 40},
				End:   protocol.Position{Line: 0, Character: 45},
			},
		}) {
		t.Fatalf("Unicode-prefixed canonical decorations = %#v, want one heading", result)
	}
	symbols := controller.Symbols(context.Background(), request)
	if len(symbols.Symbols) != 1 ||
		symbols.Symbols[0].SelectionRange != (protocol.Range{
			Start: protocol.Position{Line: 0, Character: 40},
			End:   protocol.Position{Line: 0, Character: 45},
		}) {
		t.Fatalf("Unicode-prefixed symbols = %#v, want exact UTF-16 selection", symbols)
	}
}

func TestCanonicalMarkdownSourceKindIgnoresLegacyFragmentMarker(t *testing.T) {
	_, _, sourceRef, _ := aliasedIdentityFixture()
	sourceRef.Metadata["fragment"] = true
	if kind, ok := canonicalMarkdownSourceKind(sourceRef); !ok ||
		kind != promptview.PromptTextSourceOwner {
		t.Fatalf("legacy-marked owner = %q, %v", kind, ok)
	}

	delete(sourceRef.Metadata["promptText"].(map[string]any), "sourceKind")
	if _, ok := canonicalMarkdownSourceKind(sourceRef); ok {
		t.Fatal("legacy marker substituted for missing compiler source kind")
	}

	_, _, sourceRef, _ = aliasedIdentityFixture()
	sourceRef.Metadata["promptText"].(map[string]any)["tag"] = "lookalike"
	if _, ok := canonicalMarkdownSourceKind(sourceRef); ok {
		t.Fatal("foreign normalized tag was accepted as canonical PromptText")
	}
}

func TestControllerRejectsCandidateWhoseWholeRangeDiffersFromSemanticRef(t *testing.T) {
	t.Parallel()

	document, file, sourceRef, analysis := aliasedIdentityFixture()
	analysis.Templates[0].Range.End.Character--
	controller := NewController(&fixedDocumentSource{document: document})

	request := Request{
		URI: document.URI, File: file, Root: "/repo", ScopeID: "/repo",
		SourceEpoch: 1, Analyzer: fixedTransientSource{result: analysis},
		Views: semanticIdentityProvider(document, file, sourceRef),
	}
	result := controller.Decorations(context.Background(), request)

	if result.Revision != document.Revision || result.Decorations == nil ||
		len(result.Decorations) != 0 {
		t.Fatalf("off-by-one candidate result = %#v, want exact clear", result)
	}
	symbols := controller.Symbols(context.Background(), request)
	if symbols.Symbols == nil || len(symbols.Symbols) != 0 {
		t.Fatalf("off-by-one candidate symbols = %#v, want exact empty", symbols)
	}
}

func TestControllerSymbolsRequireCurrentSemanticView(t *testing.T) {
	t.Parallel()

	document, file, sourceRef, _ := aliasedIdentityFixture()
	savedDocument := document
	savedDocument.Revision.SourceHash = "different-saved-source"
	controller := NewController(&fixedDocumentSource{document: document})

	result := controller.Symbols(context.Background(), Request{
		URI: document.URI, File: file, Root: "/repo", ScopeID: "/repo",
		SourceEpoch: 1, Analyzer: panicTransientSource{},
		Views: semanticIdentityProvider(savedDocument, file, sourceRef),
	})

	if result.Revision != document.Revision || result.Symbols == nil ||
		len(result.Symbols) != 0 {
		t.Fatalf("different-buffer symbols = %#v, want exact empty without analysis", result)
	}
}

func aliasedIdentityFixture() (
	transient.Document,
	string,
	api.ProjectSourceRef,
	readmodel.PromptTextResult,
) {
	const (
		file   = "/repo/src/aliased.ts"
		source = "const value = text`# Alias`\n"
	)
	document := transient.Document{
		URI:        protocol.DocumentURI("file:///repo/src/aliased.ts"),
		LanguageID: "typescript",
		Version:    1,
		Text:       source,
		Revision:   transient.NewRevision(1, 1, source),
	}
	wholeRange := staticprotocol.PromptTextRange{
		Start: staticprotocol.PromptTextPosition{Line: 0, Character: 14},
		End:   staticprotocol.PromptTextPosition{Line: 0, Character: 27},
	}
	headingRange := staticprotocol.PromptTextRange{
		Start: staticprotocol.PromptTextPosition{Line: 0, Character: 19},
		End:   staticprotocol.PromptTextPosition{Line: 0, Character: 26},
	}
	textRange := staticprotocol.PromptTextRange{
		Start: staticprotocol.PromptTextPosition{Line: 0, Character: 21},
		End:   staticprotocol.PromptTextPosition{Line: 0, Character: 26},
	}
	sourceRef := api.ProjectSourceRef{
		ID:       "prompt:aliased:source:prompt:prompt-text",
		Role:     "prompt",
		Property: "prompt",
		Fidelity: "resolved",
		Source:   api.SourceLoc{File: file, Line: 1, Column: intPointer(15)},
		Snippet: &api.SourceSnippet{
			Source:   "text`# Alias`",
			Language: "typescript",
			Range: api.SourceRange{
				File: file, StartLine: 1, StartColumn: intPointer(15),
				EndLine: intPointer(1), EndColumn: intPointer(28),
			},
		},
		Metadata: map[string]any{"promptText": map[string]any{
			"tag": "md", "language": "markdown", "lifecycle": "static",
			"sourceKind": "owner",
		}},
	}
	analysis := readmodel.PromptTextResult{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            file,
		Revision:        document.Revision,
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Templates: []staticprotocol.PromptTextTemplate{{
			CandidateID: 0,
			Range:       wholeRange,
			LiteralIslands: []staticprotocol.PromptTextLiteralIsland{{
				Index: 0, Range: headingRange,
			}},
			Status: staticprotocol.PromptTextAnalysisStatus{
				Kind: staticprotocol.PromptTextStatusComplete,
			},
			Blocks: []staticprotocol.PromptTextBlock{{
				Kind: staticprotocol.PromptTextBlockHeading, Level: 1,
				Label: promptTextLabel("Alias"),
				Range: headingRange, TextRange: &textRange,
			}},
		}},
	}
	return document, file, sourceRef, analysis
}

func unicodeIdentityFixture() (
	transient.Document,
	string,
	api.ProjectSourceRef,
	readmodel.PromptTextResult,
) {
	document, file, sourceRef, analysis := aliasedIdentityFixture()
	const source = "const face = \"😀\"; const value = text`# Alias`\n"
	document.Text = source
	document.Revision = transient.NewRevision(1, 1, source)
	sourceRef.Source.Column = intPointer(34)
	sourceRef.Snippet.Source = "text`# Alias`"
	sourceRef.Snippet.Range.StartColumn = intPointer(34)
	sourceRef.Snippet.Range.EndColumn = intPointer(47)
	analysis.Revision = document.Revision
	analysis.Templates[0].Range = staticprotocol.PromptTextRange{
		Start: staticprotocol.PromptTextPosition{Line: 0, Character: 33},
		End:   staticprotocol.PromptTextPosition{Line: 0, Character: 46},
	}
	analysis.Templates[0].Blocks[0].Range = staticprotocol.PromptTextRange{
		Start: staticprotocol.PromptTextPosition{Line: 0, Character: 38},
		End:   staticprotocol.PromptTextPosition{Line: 0, Character: 45},
	}
	analysis.Templates[0].LiteralIslands[0].Range =
		analysis.Templates[0].Blocks[0].Range
	textRange := staticprotocol.PromptTextRange{
		Start: staticprotocol.PromptTextPosition{Line: 0, Character: 40},
		End:   staticprotocol.PromptTextPosition{Line: 0, Character: 45},
	}
	analysis.Templates[0].Blocks[0].TextRange = &textRange
	return document, file, sourceRef, analysis
}

func semanticIdentityProvider(
	document transient.Document,
	file string,
	sourceRefs ...api.ProjectSourceRef,
) indexview.ViewProvider {
	generation := uint64(4)
	store := readmodel.NewStore()
	store.ApplySnapshot("/repo", readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{{
			ID: "prompt:aliased", SourceRefs: sourceRefs,
		}},
		Sources: []api.IndexSourceFile{{
			File: file, Status: "indexed", SourceHash: document.Revision.SourceHash,
		}},
	})
	return indexview.NewSavedProvider(store)
}
