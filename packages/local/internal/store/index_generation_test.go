package store

import "testing"

func TestCaptureProjectIndexAdvancesGenerationWithReplacement(t *testing.T) {
	indexStore := NewStore()
	before := indexStore.CaptureProjectIndex()

	indexStore.SetIndexData(IndexData{
		Definitions: []ProjectDefinition{{
			ID: "prompt:greeting", Kind: "prompt", Name: "Greeting",
		}},
	})
	after := indexStore.CaptureProjectIndex()

	if after.Generation <= before.Generation {
		t.Fatalf(
			"generation after replacement = %d, want greater than %d",
			after.Generation,
			before.Generation,
		)
	}
	if len(after.Index.Definitions) != 1 ||
		after.Index.Definitions[0].ID != "prompt:greeting" {
		t.Fatalf("captured definitions = %+v", after.Index.Definitions)
	}
}
