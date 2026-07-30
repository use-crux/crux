package transient

import (
	"context"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	indexprompttext "github.com/use-crux/crux/packages/local/internal/projectindex/prompttext"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestCoordinatorKeysCanonicalFragmentsAndSelectedViewIdentity(t *testing.T) {
	t.Parallel()

	const file = "/repo/src/writer.ts"
	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	document := Document{
		URI: uri, LanguageID: "typescript", Version: 1, Text: "md`# Hello`",
		Revision: NewRevision(1, 1, "md`# Hello`"),
	}
	source := &mutableDocumentSource{document: document}
	analyzer := &recordingTransientSource{}
	query := Query{
		URI: uri, File: file, ScopeID: "/repo", SourceEpoch: 3,
		BaseGeneration: 4, ViewRevision: 5, Analyzer: analyzer,
		Fragments: []staticprotocol.PromptTextFragment{
			transientFragment("second", "z"),
			transientFragment("first", "a"),
		},
	}
	coordinator := NewCoordinator(source)

	if _, err := coordinator.Analyze(context.Background(), query); err != nil {
		t.Fatal(err)
	}
	query.Fragments[0], query.Fragments[1] = query.Fragments[1], query.Fragments[0]
	if _, err := coordinator.Analyze(context.Background(), query); err != nil {
		t.Fatal(err)
	}
	if analyzer.calls != 1 {
		t.Fatalf("reordered catalogue calls = %d, want one", analyzer.calls)
	}
	if got := analyzer.requests[0].Fragments; got[0].ID != "first" || got[1].ID != "second" {
		t.Fatalf("worker fragments = %#v, want canonical order", got)
	}
	query.FragmentJoins = []staticprotocol.PromptTextFragmentJoin{
		transientJoin(file, document.Revision.SourceHash, "second", 1),
		transientJoin(file, document.Revision.SourceHash, "first", 0),
	}
	if _, err := coordinator.Analyze(context.Background(), query); err != nil {
		t.Fatal(err)
	}
	query.FragmentJoins[0], query.FragmentJoins[1] =
		query.FragmentJoins[1], query.FragmentJoins[0]
	if _, err := coordinator.Analyze(context.Background(), query); err != nil {
		t.Fatal(err)
	}
	if analyzer.calls != 2 {
		t.Fatalf("reordered join calls = %d, want two total", analyzer.calls)
	}
	if got := analyzer.requests[1].FragmentJoins; got[0].FragmentID != "first" ||
		got[1].FragmentID != "second" {
		t.Fatalf("worker joins = %#v, want canonical order", got)
	}
	validFragments := append([]staticprotocol.PromptTextFragment(nil), query.Fragments...)

	query.Fragments = append(query.Fragments, query.Fragments[0])
	if _, err := coordinator.Analyze(context.Background(), query); err == nil {
		t.Fatal("duplicate catalogue reused cached analysis")
	}
	if analyzer.calls != 2 {
		t.Fatalf("invalid catalogue calls = %d, want cached result rejected", analyzer.calls)
	}

	query.Fragments = []staticprotocol.PromptTextFragment{
		transientFragment(
			"overflow",
			strings.Repeat("x", int(indexprompttext.DefaultLimits().MaxFragmentBytes)),
		),
	}
	if _, err := coordinator.Analyze(context.Background(), query); err == nil {
		t.Fatal("aggregate overflow reused cached analysis")
	}
	if analyzer.calls != 2 {
		t.Fatalf("overflow catalogue calls = %d, want cached result rejected", analyzer.calls)
	}
	query.Fragments = validFragments

	query.Fragments[0].Snippet = "changed"
	if _, err := coordinator.Analyze(context.Background(), query); err != nil {
		t.Fatal(err)
	}
	query.ViewRevision++
	if _, err := coordinator.Analyze(context.Background(), query); err != nil {
		t.Fatal(err)
	}
	query.BaseGeneration++
	if _, err := coordinator.Analyze(context.Background(), query); err != nil {
		t.Fatal(err)
	}
	if analyzer.calls != 5 {
		t.Fatalf("identity-changing calls = %d, want five", analyzer.calls)
	}
}

func transientJoin(
	file string,
	sourceHash string,
	fragmentID string,
	interpolation uint32,
) staticprotocol.PromptTextFragmentJoin {
	return staticprotocol.PromptTextFragmentJoin{
		Key: staticprotocol.PromptTextInterpolationJoinKey{
			File: file, SourceHash: sourceHash,
			TemplateRange: staticprotocol.PromptTextRange{
				Start: staticprotocol.PromptTextPosition{},
				End:   staticprotocol.PromptTextPosition{Character: 11},
			},
			Interpolation: interpolation,
			ExpressionRange: staticprotocol.PromptTextRange{
				Start: staticprotocol.PromptTextPosition{Character: 3 + interpolation},
				End:   staticprotocol.PromptTextPosition{Character: 4 + interpolation},
			},
		},
		FragmentID: fragmentID,
		Proof:      staticprotocol.PromptTextProofSemanticExact,
	}
}
