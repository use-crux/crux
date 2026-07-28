package prompttext

import (
	"context"
	"testing"
	"unicode/utf16"

	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestLanguageNavigationPreservesCanonicalBindingFormsAndUTF16Ranges(
	t *testing.T,
) {
	for _, tag := range []string{"md", "text", "core.md", "render"} {
		t.Run(tag, func(t *testing.T) {
			const prefix = "const value = "
			source := prefix + tag + "`# Héllo 😀`;\r\nconst owner = 1;"
			document := transient.Document{
				URI: "file:///repo/source.ts", LanguageID: "typescript",
				Version: 1, Text: source,
				Revision: transient.NewRevision(1, 1, source),
			}
			start := utf16LengthForLanguageTest(prefix)
			open := start + utf16LengthForLanguageTest(tag)
			close := open + utf16LengthForLanguageTest("`# Héllo 😀")
			templateRange := navigationRange(0, start, 0, close+1)
			view := &promptview.View{
				Stamp: promptview.Stamp{Project: indexview.ViewStamp{
					ScopeID: "scope", BaseGeneration: 1,
					BaseGenerationKnown: true, Revision: 1,
					Origin:   indexview.ViewOriginSaved,
					Evidence: indexview.EvidenceSemantic,
				}},
				Definitions: []promptview.Definition{{
					ID: "prompt:owner", Kind: "prompt", Name: "owner",
					Location: promptview.Location{
						File:  "/repo/source.ts",
						Range: navigationRange(1, 6, 1, 11),
					},
				}},
				PromptTextRefs: []promptview.PromptTextSourceRef{{
					Key: promptview.SourceRefKey{
						DefinitionID: "prompt:owner",
						SourceRefID:  "prompt:owner:source:prompt",
					},
					Role: "prompt", Property: "prompt", Lifecycle: "static",
					SourceKind: promptview.PromptTextSourceOwner,
					Template: promptview.Location{
						File: "/repo/source.ts", Range: templateRange,
					},
				}},
			}
			analysis := staticprotocol.PromptTextQueryResponse{
				ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
				File:            "/repo/source.ts",
				Revision:        document.Revision,
				Status: staticprotocol.PromptTextAnalysisStatus{
					Kind: staticprotocol.PromptTextStatusComplete,
				},
				Templates: []staticprotocol.PromptTextTemplate{{
					Range:         navigationStaticRange(templateRange),
					TemplateRange: navigationStaticRange(templateRange),
					BacktickRanges: [2]staticprotocol.PromptTextRange{
						navigationStaticRange(navigationRange(0, open, 0, open+1)),
						navigationStaticRange(navigationRange(0, close, 0, close+1)),
					},
					Status: staticprotocol.PromptTextAnalysisStatus{
						Kind: staticprotocol.PromptTextStatusComplete,
					},
				}},
				Refactors: staticprotocol.PromptTextRefactorAnalysis{
					Status: staticprotocol.PromptTextAnalysisStatus{
						Kind: staticprotocol.PromptTextStatusComplete,
					},
					Proofs: []staticprotocol.PromptTextRefactorProof{},
				},
			}
			views := &refactorViewProvider{
				selection: promptview.Selection{
					Status: indexview.ViewStatusExact,
					View:   view,
				},
				current: true,
			}
			controller := NewController(&fixedDocumentSource{document: document})

			result := controller.Navigation(
				context.Background(),
				LanguageRequest{
					URI: document.URI, File: "/repo/source.ts",
					ScopeID: "scope", SourceEpoch: 1,
					Analyzer: fixedTransientSource{result: analysis},
					Views:    views,
				},
				protocol.Position{Line: 0, Character: open + 4},
				false,
			)

			if !result.Handled || !result.Claimed ||
				result.Definition == nil ||
				result.Definition.Range != navigationRange(1, 6, 1, 11) {
				t.Fatalf("%q binding navigation = %#v", tag, result)
			}
		})
	}
}

func TestLanguageFeaturesShareCurrentTransformedAndTransientEvidence(t *testing.T) {
	source := "md`hello ${value}`\nmd`detail`\nowner"
	document := transient.Document{
		URI: "file:///repo/source.ts", LanguageID: "typescript",
		Version: 2, Text: source, Revision: transient.NewRevision(1, 2, source),
	}
	view, analysis := navigationFixture()
	stamp := promptview.Stamp{Project: indexview.ViewStamp{
		ScopeID: "scope", BaseGeneration: 3, BaseGenerationKnown: true,
		Revision: 4, Origin: indexview.ViewOriginSaved,
		Evidence: indexview.EvidenceSemantic,
	}}
	view.Stamp = stamp
	view.Definitions[0].Location.File = "/repo/owner.ts"
	view.Documents = []promptview.DocumentStamp{
		{
			File: "/repo/owner.ts",
			Revision: indexview.DocumentRevision{
				OpenEpoch: 2, Version: 3, SourceHash: "owner",
			},
			TransformRevision: stamp.TransformRevision,
		},
		{
			File: "/repo/source.ts",
			Revision: indexview.DocumentRevision{
				OpenEpoch:  document.Revision.OpenEpoch,
				Version:    document.Version,
				SourceHash: document.Revision.SourceHash,
			},
			TransformRevision: stamp.TransformRevision,
		},
	}
	analysis.ProtocolVersion = staticprotocol.PromptTextProtocolVersion
	analysis.File = "/repo/source.ts"
	analysis.Revision = document.Revision
	analysis.Refactors = staticprotocol.PromptTextRefactorAnalysis{
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Proofs: []staticprotocol.PromptTextRefactorProof{},
	}
	views := &refactorViewProvider{
		selection: promptview.Selection{
			Status: indexview.ViewStatusSavedFallback,
			View:   view,
		},
		current: true,
	}
	controller := NewController(&fixedDocumentSource{document: document})
	request := LanguageRequest{
		URI: document.URI, File: "/repo/source.ts", ScopeID: "scope",
		SourceEpoch: 1, Analyzer: fixedTransientSource{result: analysis},
		Views: views,
	}

	navigation := controller.Navigation(
		context.Background(),
		request,
		protocol.Position{Character: 4},
		true,
	)
	if !navigation.Claimed || navigation.Definition == nil ||
		navigation.Revision != document.Revision || navigation.Stamp != stamp ||
		len(navigation.ContributingFiles) != 2 ||
		len(navigation.Documents) != 2 {
		t.Fatalf("navigation = %#v", navigation)
	}
	hover := controller.Hover(
		context.Background(),
		request,
		protocol.Position{Character: 4},
	)
	if !hover.Claimed || hover.Revision != document.Revision ||
		hover.Evidence != "saved semantic fallback; current syntax matched" ||
		hover.Stamp != stamp || len(hover.ContributingFiles) != 2 ||
		len(hover.Documents) != 2 {
		t.Fatalf("hover = %#v", hover)
	}
	if views.selects != 2 || views.currentChecks != 2 {
		t.Fatalf("provider calls = %#v, want one selection/check per request", views)
	}
}

func TestLanguageFeaturesDiscardAfterSecondViewStampMismatch(t *testing.T) {
	source := "md`hello ${value}`\nmd`detail`\nowner"
	document := transient.Document{
		URI: "file:///repo/source.ts", LanguageID: "typescript",
		Version: 2, Text: source, Revision: transient.NewRevision(1, 2, source),
	}
	view, analysis := navigationFixture()
	view.Stamp = promptview.Stamp{Project: indexview.ViewStamp{
		ScopeID: "scope", BaseGeneration: 3, BaseGenerationKnown: true,
		Revision: 4, Origin: indexview.ViewOriginSaved,
		Evidence: indexview.EvidenceSemantic,
	}}
	analysis.File = "/repo/source.ts"
	analysis.Revision = document.Revision
	views := &refactorViewProvider{
		selection: promptview.Selection{
			Status: indexview.ViewStatusExact,
			View:   view,
		},
		current: false,
	}
	controller := NewController(&fixedDocumentSource{document: document})
	result := controller.Navigation(
		context.Background(),
		LanguageRequest{
			URI: document.URI, File: "/repo/source.ts", ScopeID: "scope",
			SourceEpoch: 1, Analyzer: fixedTransientSource{result: analysis},
			Views: views,
		},
		protocol.Position{Character: 4},
		false,
	)
	if result.Definition != nil || len(result.References) != 0 ||
		!result.Handled || views.selects != 2 || views.currentChecks != 2 {
		t.Fatalf("stale navigation = %#v, provider=%#v", result, views)
	}

	views.selects, views.currentChecks = 0, 0
	hover := controller.Hover(
		context.Background(),
		LanguageRequest{
			URI: document.URI, File: "/repo/source.ts", ScopeID: "scope",
			SourceEpoch: 1, Analyzer: fixedTransientSource{result: analysis},
			Views: views,
		},
		protocol.Position{Character: 4},
	)
	if hover.Revision != document.Revision || !hover.Handled || hover.Claimed ||
		views.selects != 2 || views.currentChecks != 2 {
		t.Fatalf("stale hover = %#v, provider=%#v", hover, views)
	}
}

func utf16LengthForLanguageTest(value string) uint32 {
	return uint32(len(utf16.Encode([]rune(value))))
}
