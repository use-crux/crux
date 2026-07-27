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
	validFragments := append([]staticprotocol.PromptTextFragment(nil), query.Fragments...)

	query.Fragments = append(query.Fragments, query.Fragments[0])
	if _, err := coordinator.Analyze(context.Background(), query); err == nil {
		t.Fatal("duplicate catalogue reused cached analysis")
	}
	if analyzer.calls != 1 {
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
	if analyzer.calls != 1 {
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
	if analyzer.calls != 4 {
		t.Fatalf("identity-changing calls = %d, want four", analyzer.calls)
	}
}
