package prompttext

import (
	"context"
	"testing"

	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestPromptPreviewExactLinkClassifiesOnlyCurrentCanonicalOwner(t *testing.T) {
	templateRange := protocol.Range{
		Start: protocol.Position{Line: 0, Character: 10},
		End:   protocol.Position{Line: 0, Character: 20},
	}
	analysis := readmodel.PromptTextResult{
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Templates: []staticprotocol.PromptTextTemplate{{
			Range: staticprotocol.PromptTextRange{
				Start: staticprotocol.PromptTextPosition{Line: 0, Character: 10},
				End:   staticprotocol.PromptTextPosition{Line: 0, Character: 20},
			},
			Status: staticprotocol.PromptTextAnalysisStatus{
				Kind: staticprotocol.PromptTextStatusComplete,
			},
			BacktickRanges: [2]staticprotocol.PromptTextRange{
				{
					Start: staticprotocol.PromptTextPosition{Line: 0, Character: 12},
					End:   staticprotocol.PromptTextPosition{Line: 0, Character: 13},
				},
				{
					Start: staticprotocol.PromptTextPosition{Line: 0, Character: 19},
					End:   staticprotocol.PromptTextPosition{Line: 0, Character: 20},
				},
			},
			LiteralIslands: []staticprotocol.PromptTextLiteralIsland{{
				Range: staticprotocol.PromptTextRange{
					Start: staticprotocol.PromptTextPosition{Line: 0, Character: 13},
					End:   staticprotocol.PromptTextPosition{Line: 0, Character: 19},
				},
			}},
			InterpolationBarriers: []staticprotocol.PromptTextInterpolationBarrier{},
		}},
	}
	view := &promptview.View{
		Definitions: []promptview.Definition{{
			ID: "prompt:writer", Kind: "prompt", Name: "Writer",
		}},
		PromptTextRefs: []promptview.PromptTextSourceRef{{
			Key: promptview.SourceRefKey{
				DefinitionID: "prompt:writer", SourceRefID: "prompt",
			},
			Role: "prompt", Property: "prompt", Lifecycle: "static",
			SourceKind: promptview.PromptTextSourceOwner,
			Template:   promptview.Location{File: "/repo/source.ts", Range: templateRange},
		}},
	}

	result := promptOwnerAt(
		view, analysis, "/repo/source.ts",
		protocol.Position{Line: 0, Character: 15},
	)
	if result.Kind != OwnerAtReady ||
		result.DefinitionID != "prompt:writer" {
		t.Fatalf("ready result = %#v", result)
	}

	view.PromptTextRefs[0].SourceKind = promptview.PromptTextSourceNamedFragment
	result = promptOwnerAt(
		view, analysis, "/repo/source.ts",
		protocol.Position{Line: 0, Character: 15},
	)
	if result.Kind != OwnerAtStaticOnly || result.Reason != "named-fragment" {
		t.Fatalf("named fragment result = %#v", result)
	}

	view.PromptTextRefs[0].SourceKind = promptview.PromptTextSourceOwner
	view.Definitions[0].Kind = "context"
	result = promptOwnerAt(
		view, analysis, "/repo/source.ts",
		protocol.Position{Line: 0, Character: 15},
	)
	if result.Kind != OwnerAtStaticOnly || result.Reason != "context-owner" {
		t.Fatalf("context result = %#v", result)
	}

	view.Definitions[0].Kind = "prompt"
	analysis.Templates[0].InterpolationBarriers = []staticprotocol.PromptTextInterpolationBarrier{{
		Range: staticprotocol.PromptTextRange{
			Start: staticprotocol.PromptTextPosition{Line: 0, Character: 14},
			End:   staticprotocol.PromptTextPosition{Line: 0, Character: 17},
		},
	}}
	result = promptOwnerAt(
		view, analysis, "/repo/source.ts",
		protocol.Position{Line: 0, Character: 15},
	)
	if result.Kind != OwnerAtUnavailable ||
		result.Reason != "template-not-found" {
		t.Fatalf("interpolation result = %#v", result)
	}
}

func TestPromptPreviewExactLinkRequiresCurrentSemanticView(t *testing.T) {
	const source = "const prompt = md`Hello`"
	document := transient.Document{
		URI:        "file:///repo/source.ts",
		LanguageID: "typescript",
		Version:    3,
		Text:       source,
		Revision:   transient.NewRevision(2, 3, source),
	}
	views := &refactorViewProvider{
		selection: promptview.Selection{
			Status: indexview.ViewStatusSavedFallback,
			View:   &promptview.View{},
		},
		current: true,
	}
	controller := NewController(&fixedDocumentSource{document: document})

	result := controller.ExactPreviewLink(
		context.Background(),
		LanguageRequest{
			URI: document.URI, File: "/repo/source.ts", ScopeID: "scope",
			SourceEpoch: 1, Analyzer: fixedTransientSource{},
			Views: views,
		},
		protocol.Position{Character: 20},
	)

	if result.Kind != ExactPreviewLinkUnavailable ||
		result.Reason != "analysis-unavailable" {
		t.Fatalf("saved fallback result = %#v", result)
	}
	if views.selects != 1 || views.currentChecks != 0 {
		t.Fatalf("provider calls = %#v", views)
	}
	if views.lastRequest.MinimumEvidence != indexview.EvidenceSemantic ||
		views.lastRequest.Freshness != indexview.RequireCurrent ||
		views.lastRequest.Document == nil ||
		views.lastRequest.Document.OpenEpoch != document.Revision.OpenEpoch ||
		views.lastRequest.Document.Version != document.Version ||
		views.lastRequest.Document.SourceHash != document.Revision.SourceHash {
		t.Fatalf("selection request = %#v", views.lastRequest)
	}
}
