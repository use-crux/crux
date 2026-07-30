package prompttext

import (
	"testing"

	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestPromptTextHoverUsesSmallestSyntaxRangeAndTransformedOwner(t *testing.T) {
	view, analysis := navigationFixture()
	analysis.Templates[0].LiteralIslands = []staticprotocol.PromptTextLiteralIsland{{
		Index: 0, Range: navigationStaticRange(navigationRange(0, 3, 0, 15)),
	}}
	analysis.Templates[0].Blocks = []staticprotocol.PromptTextBlock{{
		Kind:  staticprotocol.PromptTextBlockParagraph,
		Range: navigationStaticRange(navigationRange(0, 3, 0, 15)),
	}}
	analysis.Templates[0].Spans = []staticprotocol.PromptTextSpan{{
		Kind:  staticprotocol.PromptTextSpanStrong,
		Range: navigationStaticRange(navigationRange(0, 3, 0, 6)),
	}}
	analysis.Templates[0].Links = []staticprotocol.PromptTextLink{{
		Kind:      staticprotocol.PromptTextLinkInline,
		Range:     navigationStaticRange(navigationRange(0, 3, 0, 5)),
		TextRange: navigationStaticRange(navigationRange(0, 3, 0, 4)),
	}}

	got := promptTextHoverAt(
		view,
		analysis,
		"/repo/source.ts",
		protocol.Position{Line: 0, Character: 4},
		indexview.ViewStatusSavedFallback,
	)
	if !got.Claimed || got.Range != navigationRange(0, 3, 0, 5) {
		t.Fatalf("hover claim = %#v", got)
	}
	if len(got.Owners) != 1 || got.Owners[0].ID != "prompt:owner" ||
		got.TemplateLabel != "direct `prompt` template" ||
		got.Lifecycle != "static" ||
		got.LiteralCount != 1 ||
		got.BarrierCount != 1 ||
		got.OutgoingFragments != 1 ||
		got.IncomingFragments != 0 ||
		got.Evidence != "saved semantic fallback; current syntax matched" {
		t.Fatalf("hover facts = %#v", got)
	}
}

func TestPromptTextHoverVetoesInterpolationBarrier(t *testing.T) {
	view, analysis := navigationFixture()
	got := promptTextHoverAt(
		view,
		analysis,
		"/repo/source.ts",
		protocol.Position{Line: 0, Character: 8},
		indexview.ViewStatusExact,
	)
	if got.Claimed {
		t.Fatalf("barrier hover = %#v, want no claim", got)
	}
}

func TestPromptTextHoverSuppressesSharedOwnerWithMissingDestination(t *testing.T) {
	view, analysis := navigationFixture()
	shared := view.PromptTextRefs[0]
	shared.Key = promptview.SourceRefKey{
		DefinitionID: "prompt:missing", SourceRefID: "missing-owner",
	}
	view.PromptTextRefs = append(view.PromptTextRefs, shared)

	got := promptTextHoverAt(
		view,
		analysis,
		"/repo/source.ts",
		protocol.Position{Line: 0, Character: 4},
		indexview.ViewStatusExact,
	)

	if got.Claimed || len(got.Owners) != 0 {
		t.Fatalf("incomplete shared-owner hover = %#v, want suppression", got)
	}
}

func TestPromptTextHoverUsesCompilerOwnedAnonymousClassification(t *testing.T) {
	view, analysis := navigationFixture()
	view.PromptTextRefs[1].SourceKind =
		promptview.PromptTextSourceAnonymousFragment
	view.PromptTextRefs[1].Symbol = ""
	view.FragmentJoins = nil

	got := promptTextHoverAt(
		view,
		analysis,
		"/repo/source.ts",
		protocol.Position{Line: 1, Character: 4},
		indexview.ViewStatusExact,
	)

	if !got.Claimed || got.TemplateLabel != "anonymous fragment" ||
		len(got.Owners) != 1 || got.Owners[0].ID != "prompt:owner" {
		t.Fatalf("anonymous hover = %#v", got)
	}
}
