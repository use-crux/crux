package prompttext

import (
	"testing"

	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
)

func TestOwnerReferencesExcludeLegacySitesForPromptTextSourceRefs(t *testing.T) {
	view, _ := navigationFixture()
	view.Sites = []promptview.Site{
		{
			ID: "owner-ref", TargetDefinitionID: "prompt:owner",
			Location: promptview.Location{
				File: "/repo/source.ts", Range: navigationRange(0, 0, 0, 0),
			},
		},
		{
			ID: "relation:use", TargetDefinitionID: "prompt:owner",
			Location: promptview.Location{
				File: "/repo/consumer.ts", Range: navigationRange(3, 4, 3, 4),
			},
		},
	}

	items := ownerReferenceItems(view, "prompt:owner")

	if len(items) != 4 {
		t.Fatalf(
			"owner reference items = %#v, want declaration, two templates, and relation site",
			items,
		)
	}
	for _, item := range items {
		if item.location.URI == "file:///repo/source.ts" &&
			item.location.Range == navigationRange(0, 0, 1, 0) {
			t.Fatalf("legacy whole-line PromptText duplicate retained: %#v", items)
		}
	}
}
