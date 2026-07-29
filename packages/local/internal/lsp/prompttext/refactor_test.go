package prompttext

import (
	"context"
	"testing"

	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestPromptTextStringRefactorBuildsOneDiagnosticFreeVersionedEdit(t *testing.T) {
	source := "agent({ prompt: \"first\\nsecond\" })"
	literal := protocol.Range{
		Start: protocol.Position{Character: 16},
		End:   protocol.Position{Character: 31},
	}
	document := transient.Document{
		URI: "file:///repo/source.ts", Version: 7, Text: source,
		Revision: transient.NewRevision(1, 7, source),
	}
	view := &promptview.View{RefactorTargets: []promptview.StringRefactorTarget{{
		Key: promptview.SourceRefKey{
			DefinitionID: "agent:owner", SourceRefID: "refactor",
		},
		Role: "prompt", Property: "prompt", Lifecycle: "static",
		Expression: promptview.Location{
			File: "/repo/source.ts", Range: literal,
		},
		Binding: promptview.RefactorBinding{
			Kind: "identifier", Expression: "markdown",
		},
		Proof: "semantic-exact",
	}}}
	analysis := staticprotocol.PromptTextRefactorAnalysis{
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Proofs: []staticprotocol.PromptTextRefactorProof{{
			Kind: "ordinary-string-to-md", Range: navigationStaticRange(literal),
			ExpectedText: `"first\nsecond"`,
			TemplateText: "`\nfirst\nsecond\n`",
			Proof:        staticprotocol.PromptTextRefactorProofSyntaxExact,
		}},
	}

	action, ok := stringRefactorAt(
		view,
		analysis,
		document,
		"/repo/source.ts",
		protocol.Range{Start: protocol.Position{Character: 20}, End: protocol.Position{Character: 20}},
	)
	if !ok || action.Title != "Convert multiline string to `md` PromptText" ||
		action.Kind != protocol.CodeActionRefactorRewrite ||
		len(action.Diagnostics) != 0 || action.Command != nil ||
		action.Edit == nil || action.Edit.Changes != nil ||
		len(action.Edit.DocumentChanges) != 1 ||
		len(action.Edit.DocumentChanges[0].Edits) != 1 {
		t.Fatalf("action = %#v, ok=%v", action, ok)
	}
	edit := action.Edit.DocumentChanges[0]
	if edit.TextDocument.URI != document.URI ||
		edit.TextDocument.Version != document.Version ||
		edit.Edits[0].Range != literal ||
		edit.Edits[0].NewText != "markdown`\nfirst\nsecond\n`" {
		t.Fatalf("edit = %#v", edit)
	}
}

func TestPromptTextStringRefactorRejectsEndPositionAndMismatchedProofBytes(t *testing.T) {
	source := "x\n"
	literal := protocol.Range{
		Start: protocol.Position{},
		End:   protocol.Position{Character: 1},
	}
	document := transient.Document{
		URI: "file:///repo/source.ts", Version: 1, Text: source,
		Revision: transient.NewRevision(1, 1, source),
	}
	view := &promptview.View{RefactorTargets: []promptview.StringRefactorTarget{{
		Expression: promptview.Location{File: "/repo/source.ts", Range: literal},
		Binding:    promptview.RefactorBinding{Kind: "identifier", Expression: "md"},
	}}}
	analysis := staticprotocol.PromptTextRefactorAnalysis{
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Proofs: []staticprotocol.PromptTextRefactorProof{{
			Kind: "ordinary-string-to-md", Range: navigationStaticRange(literal),
			ExpectedText: "different", TemplateText: "`x`",
			Proof: staticprotocol.PromptTextRefactorProofSyntaxExact,
		}},
	}
	if _, ok := stringRefactorAt(
		view,
		analysis,
		document,
		"/repo/source.ts",
		protocol.Range{Start: literal.End, End: literal.End},
	); ok {
		t.Fatal("literal-end position produced a refactor")
	}
}

func TestControllerStringRefactorRequiresCurrentTransformedView(t *testing.T) {
	source := "agent({ prompt: \"first\\nsecond\" })"
	literal := navigationRange(0, 16, 0, 31)
	document := transient.Document{
		URI: "file:///repo/source.ts", LanguageID: "typescript",
		Version: 7, Text: source, Revision: transient.NewRevision(1, 7, source),
	}
	stamp := promptview.Stamp{Project: indexview.ViewStamp{
		ScopeID: "scope", BaseGeneration: 3, BaseGenerationKnown: true,
		Revision: 4, Origin: indexview.ViewOriginSaved,
		Evidence: indexview.EvidenceSemantic,
	}}
	views := &refactorViewProvider{
		selection: promptview.Selection{
			Status: indexview.ViewStatusExact,
			View: &promptview.View{
				Stamp: stamp,
				RefactorTargets: []promptview.StringRefactorTarget{{
					Expression: promptview.Location{
						File: "/repo/source.ts", Range: literal,
					},
					Binding: promptview.RefactorBinding{
						Kind: "identifier", Expression: "md",
					},
				}},
			},
		},
		current: true,
	}
	response := staticprotocol.PromptTextQueryResponse{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            "/repo/source.ts",
		Revision:        document.Revision,
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Templates: []staticprotocol.PromptTextTemplate{},
		Refactors: staticprotocol.PromptTextRefactorAnalysis{
			Status: staticprotocol.PromptTextAnalysisStatus{
				Kind: staticprotocol.PromptTextStatusComplete,
			},
			Proofs: []staticprotocol.PromptTextRefactorProof{{
				Kind:         "ordinary-string-to-md",
				Range:        navigationStaticRange(literal),
				ExpectedText: `"first\nsecond"`,
				TemplateText: "`\nfirst\nsecond\n`",
				Proof:        staticprotocol.PromptTextRefactorProofSyntaxExact,
			}},
		},
	}
	controller := NewController(&fixedDocumentSource{document: document})
	request := LanguageRequest{
		URI: document.URI, File: "/repo/source.ts", ScopeID: "scope",
		SourceEpoch: 1, Analyzer: fixedTransientSource{result: response},
		Views: views,
	}
	result := controller.StringRefactor(
		context.Background(),
		request,
		protocol.Range{
			Start: protocol.Position{Character: 20},
			End:   protocol.Position{Character: 20},
		},
	)
	if len(result.Actions) != 1 || result.Revision != document.Revision ||
		result.Stamp != stamp || views.selects != 1 || views.currentChecks != 1 {
		t.Fatalf("result = %#v, provider=%#v", result, views)
	}

	views.selection.Status = indexview.ViewStatusSavedFallback
	views.selects, views.currentChecks = 0, 0
	result = controller.StringRefactor(
		context.Background(),
		request,
		protocol.Range{
			Start: protocol.Position{Character: 20},
			End:   protocol.Position{Character: 20},
		},
	)
	if len(result.Actions) != 0 || views.selects != 1 || views.currentChecks != 0 {
		t.Fatalf("saved-fallback result = %#v, provider=%#v", result, views)
	}
}

type refactorViewProvider struct {
	selection     promptview.Selection
	current       bool
	selects       int
	currentChecks int
	lastRequest   promptview.Request
}

func (p *refactorViewProvider) Select(
	_ context.Context,
	request promptview.Request,
) promptview.Selection {
	p.selects++
	p.lastRequest = request
	return p.selection
}

func (p *refactorViewProvider) Current(promptview.Stamp) bool {
	p.currentChecks++
	return p.current
}
