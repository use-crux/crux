package readmodel

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestPromptTextSourceKindSurvivesStoreSnapshotAndDelta(t *testing.T) {
	t.Parallel()

	generation := uint64(1)
	store := NewStore()
	store.ApplySnapshot("scope", Snapshot{
		Generation: &generation,
		Definitions: []api.ProjectDefinition{
			promptTextSourceKindDefinition("owner", "", true),
		},
	})
	assertStoredPromptTextSourceKind(t, store, "owner", true)

	result := store.ApplyDelta("scope", Delta{
		Generation: 2,
		File:       "src/writer.ts",
		Definitions: DefinitionChanges{Changed: []api.ProjectDefinition{
			promptTextSourceKindDefinition(
				"named-fragment",
				"shared",
				false,
			),
		}},
	})
	if result.Status != DeltaApplied {
		t.Fatalf("delta status = %v, want applied", result.Status)
	}
	assertStoredPromptTextSourceKind(t, store, "named-fragment", false)
}

func promptTextSourceKindDefinition(
	sourceKind, symbol string,
	legacyFragment bool,
) api.ProjectDefinition {
	metadata := map[string]any{"promptText": map[string]any{
		"tag": "md", "language": "markdown", "lifecycle": "static",
		"sourceKind": sourceKind,
	}}
	if legacyFragment {
		metadata["fragment"] = true
	}
	return api.ProjectDefinition{
		ID: "prompt:writer", Kind: "prompt", Name: "writer",
		Source: &api.SourceLoc{File: "src/writer.ts", Line: 1},
		SourceRefs: []api.ProjectSourceRef{{
			ID: "prompt:writer:source:prompt", Role: "prompt",
			Property: "prompt", Symbol: symbol,
			Source:   api.SourceLoc{File: "src/writer.ts", Line: 1},
			Fidelity: "resolved", Metadata: metadata,
		}},
	}
}

func assertStoredPromptTextSourceKind(
	t *testing.T,
	store *Store,
	want string,
	wantLegacy bool,
) {
	t.Helper()
	definition, ok := store.Definition("scope", "prompt:writer")
	if !ok || len(definition.SourceRefs) != 1 {
		t.Fatalf("stored definition = %#v, %v", definition, ok)
	}
	metadata := definition.SourceRefs[0].Metadata
	promptText, ok := metadata["promptText"].(map[string]any)
	legacy, _ := metadata["fragment"].(bool)
	if !ok || promptText["sourceKind"] != want || legacy != wantLegacy {
		t.Fatalf(
			"stored PromptText metadata = %#v, want sourceKind %q legacy %v",
			metadata,
			want,
			wantLegacy,
		)
	}
}
