package prompttext

import (
	"testing"

	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestPromptTextNavigationClaimsOnlyQuasisAndBackticks(t *testing.T) {
	view, analysis := navigationFixture()
	tests := []struct {
		name     string
		position protocol.Position
		handled  bool
		claimed  bool
	}{
		{name: "tag", position: navigationPosition(0, 1), handled: true},
		{name: "opening backtick", position: navigationPosition(0, 2), handled: true, claimed: true},
		{name: "literal", position: navigationPosition(0, 4), handled: true, claimed: true},
		{name: "barrier", position: navigationPosition(0, 8), handled: true},
		{name: "closing backtick", position: navigationPosition(0, 15), handled: true, claimed: true},
		{name: "after", position: navigationPosition(0, 16)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := navigationAt(view, analysis, "/repo/source.ts", test.position, true)
			if got.Handled != test.handled || got.Claimed != test.claimed {
				t.Fatalf("navigation = %#v, want handled=%v claimed=%v", got, test.handled, test.claimed)
			}
		})
	}
}

func TestPromptTextNavigationSuppressesLegacyFallbackWithoutSemanticRefs(t *testing.T) {
	_, analysis := navigationFixture()
	got := navigationAt(
		&promptview.View{},
		analysis,
		"/repo/source.ts",
		navigationPosition(0, 4),
		true,
	)
	if !got.Handled || got.Claimed || got.Definition != nil ||
		len(got.References) != 0 {
		t.Fatalf("navigation = %#v, want syntax-only suppression", got)
	}
}

func TestPromptTextNavigationVetoesIncompleteTransientAnalysis(t *testing.T) {
	view, analysis := navigationFixture()
	for _, status := range []staticprotocol.PromptTextStatusKind{
		staticprotocol.PromptTextStatusTruncated,
		staticprotocol.PromptTextStatusUnsupported,
	} {
		analysis.Status.Kind = status
		got := navigationAt(
			view,
			analysis,
			"/repo/source.ts",
			navigationPosition(0, 4),
			true,
		)
		if !got.Handled || got.Claimed || got.Definition != nil ||
			len(got.References) != 0 {
			t.Fatalf("%s navigation = %#v, want suppression only", status, got)
		}
	}
}

func TestPromptTextNavigationUsesUniqueOwnerAndExactFragmentReferences(t *testing.T) {
	view, analysis := navigationFixture()
	direct := navigationAt(
		view,
		analysis,
		"/repo/source.ts",
		navigationPosition(0, 4),
		true,
	)
	if direct.Definition == nil ||
		direct.Definition.URI != "file:///repo/source.ts" ||
		direct.Definition.Range != navigationRange(2, 0, 2, 5) {
		t.Fatalf("direct definition = %#v", direct.Definition)
	}

	fragment := navigationAt(
		view,
		analysis,
		"/repo/source.ts",
		navigationPosition(1, 4),
		true,
	)
	if fragment.Definition == nil ||
		fragment.Definition.Range != navigationRange(2, 0, 2, 5) {
		t.Fatalf("fragment definition = %#v", fragment.Definition)
	}
	if len(fragment.References) != 2 ||
		fragment.References[0].Range != navigationRange(1, 0, 1, 9) ||
		fragment.References[1].Range != navigationRange(0, 7, 0, 14) {
		t.Fatalf("fragment references = %#v", fragment.References)
	}
}

func TestPromptTextNavigationGroupsExactSharedFragmentDeclarations(t *testing.T) {
	view, analysis := navigationFixture()
	shared := view.PromptTextRefs[1]
	shared.Key = promptview.SourceRefKey{
		DefinitionID: "prompt:other", SourceRefID: "other-fragment",
	}
	view.PromptTextRefs = append(view.PromptTextRefs, shared)
	view.Definitions = append(view.Definitions, promptview.Definition{
		ID: "prompt:other", Kind: "prompt", Name: "other",
		Location: promptview.Location{
			File: "/repo/source.ts", Range: navigationRange(3, 0, 3, 5),
		},
	})
	view.FragmentJoins = append(view.FragmentJoins, promptview.FragmentJoin{
		Key: promptview.FragmentJoinKey{
			DefinitionID: "prompt:other", OwnerSourceRefID: "other-owner",
			InterpolationIndex: 0, TargetSourceRefID: "other-fragment",
		},
		OwnerTemplate: promptview.Location{
			File: "/repo/source.ts", Range: navigationRange(4, 0, 4, 16),
		},
		Expression: promptview.Location{
			File: "/repo/source.ts", Range: navigationRange(4, 7, 4, 14),
		},
		TargetTemplate: shared.Template,
		Proof:          "semantic-exact",
	})

	got := navigationAt(
		view,
		analysis,
		"/repo/source.ts",
		navigationPosition(1, 4),
		true,
	)
	if got.Definition != nil {
		t.Fatalf("shared fragment definition = %#v, want ambiguity", got.Definition)
	}
	if len(got.References) != 3 ||
		got.References[0].Range != navigationRange(1, 0, 1, 9) ||
		got.References[1].Range != navigationRange(0, 7, 0, 14) ||
		got.References[2].Range != navigationRange(4, 7, 4, 14) {
		t.Fatalf("shared fragment references = %#v", got.References)
	}
}

func TestPromptTextNavigationDoesNotGroupAnonymousFragmentsAsNamed(t *testing.T) {
	view, analysis := navigationFixture()
	view.PromptTextRefs[1].SourceKind =
		promptview.PromptTextSourceAnonymousFragment
	view.PromptTextRefs[1].Symbol = ""
	view.FragmentJoins = nil

	got := navigationAt(
		view,
		analysis,
		"/repo/source.ts",
		navigationPosition(1, 4),
		true,
	)

	if got.Definition == nil ||
		got.Definition.Range != navigationRange(2, 0, 2, 5) {
		t.Fatalf("anonymous definition = %#v", got.Definition)
	}
	if len(got.References) != 3 ||
		got.References[0].Range != navigationRange(2, 0, 2, 5) ||
		got.References[1].Range != navigationRange(0, 0, 0, 16) ||
		got.References[2].Range != navigationRange(1, 0, 1, 9) {
		t.Fatalf("anonymous references = %#v, want owner references", got.References)
	}
}

func navigationFixture() (*promptview.View, staticprotocol.PromptTextQueryResponse) {
	directRange := navigationRange(0, 0, 0, 16)
	fragmentRange := navigationRange(1, 0, 1, 9)
	view := &promptview.View{
		Definitions: []promptview.Definition{{
			ID: "prompt:owner", Kind: "prompt", Name: "owner",
			Location: promptview.Location{
				File: "/repo/source.ts", Range: navigationRange(2, 0, 2, 5),
			},
		}},
		PromptTextRefs: []promptview.PromptTextSourceRef{
			{
				Key: promptview.SourceRefKey{
					DefinitionID: "prompt:owner", SourceRefID: "owner-ref",
				},
				Role: "prompt", Property: "prompt", Lifecycle: "static",
				SourceKind: promptview.PromptTextSourceOwner,
				Template: promptview.Location{
					File: "/repo/source.ts", Range: directRange,
				},
			},
			{
				Key: promptview.SourceRefKey{
					DefinitionID: "prompt:owner", SourceRefID: "fragment-ref",
				},
				Role: "prompt", Property: "prompt", Symbol: "details",
				Lifecycle:  "static",
				SourceKind: promptview.PromptTextSourceNamedFragment,
				Template: promptview.Location{
					File: "/repo/source.ts", Range: fragmentRange,
				},
			},
		},
		FragmentJoins: []promptview.FragmentJoin{{
			Key: promptview.FragmentJoinKey{
				DefinitionID: "prompt:owner", OwnerSourceRefID: "owner-ref",
				InterpolationIndex: 0, TargetSourceRefID: "fragment-ref",
			},
			OwnerTemplate: promptview.Location{
				File: "/repo/source.ts", Range: directRange,
			},
			Expression: promptview.Location{
				File: "/repo/source.ts", Range: navigationRange(0, 7, 0, 14),
			},
			TargetTemplate: promptview.Location{
				File: "/repo/source.ts", Range: fragmentRange,
			},
			Proof: "semantic-exact",
		}},
	}
	return view, staticprotocol.PromptTextQueryResponse{
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Templates: []staticprotocol.PromptTextTemplate{
			navigationTemplate(directRange, navigationRange(0, 7, 0, 14)),
			navigationTemplate(fragmentRange, protocol.Range{}),
		},
	}
}

func navigationTemplate(
	source protocol.Range,
	barrier protocol.Range,
) staticprotocol.PromptTextTemplate {
	template := staticprotocol.PromptTextTemplate{
		Range:         navigationStaticRange(source),
		TemplateRange: navigationStaticRange(source),
		BacktickRanges: [2]staticprotocol.PromptTextRange{
			navigationStaticRange(navigationRange(source.Start.Line, 2, source.Start.Line, 3)),
			navigationStaticRange(navigationRange(source.End.Line, source.End.Character-1, source.End.Line, source.End.Character)),
		},
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
	}
	if barrier != (protocol.Range{}) {
		template.InterpolationBarriers = []staticprotocol.PromptTextInterpolationBarrier{{
			Range: navigationStaticRange(barrier),
		}}
	}
	return template
}

func navigationStaticRange(value protocol.Range) staticprotocol.PromptTextRange {
	return staticprotocol.PromptTextRange{
		Start: staticprotocol.PromptTextPosition(value.Start),
		End:   staticprotocol.PromptTextPosition(value.End),
	}
}

func navigationRange(
	startLine, startCharacter, endLine, endCharacter uint32,
) protocol.Range {
	return protocol.Range{
		Start: navigationPosition(startLine, startCharacter),
		End:   navigationPosition(endLine, endCharacter),
	}
}

func navigationPosition(line, character uint32) protocol.Position {
	return protocol.Position{Line: line, Character: character}
}
