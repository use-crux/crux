package cache

import (
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestReplayFactsRetainsDefinitionExtractorProvenance(t *testing.T) {
	root := t.TempDir()
	cacheKey := "extractor-provenance"
	definition := store.ProjectDefinition{
		ID: "prompt:writer", Kind: "prompt", Name: "writer", Fidelity: "resolved", Status: "active",
	}
	extractors := map[string][]projectindex.IndexFactExtractorProvenance{
		"prompt:writer": {
			{Name: "prompt"},
			{Name: "custom", Extension: &projectindex.IndexFactProducer{Name: "@acme/indexer", Version: "1.2.3"}},
		},
	}
	if err := WriteExtraction(root, cacheKey, WritableExtraction{
		File: "src/writer.ts", Definitions: []store.ProjectDefinition{definition}, Relations: []store.ProjectRelation{},
		Diagnostics: []store.IndexDiagnostic{}, Dependencies: []string{}, DefinitionExtractors: extractors,
	}); err != nil {
		t.Fatal(err)
	}

	facts, err := ReplayFacts(root, "project", []protocol.SourceFile{{
		File: "src/writer.ts", SourceHash: "sha256:writer", CacheKey: cacheKey,
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(facts) != 1 {
		t.Fatalf("replayed facts = %d, want 1", len(facts))
	}
	var replayed struct {
		DefinitionExtractors map[string][]projectindex.IndexFactExtractorProvenance `json:"definitionExtractors"`
	}
	if err := json.Unmarshal(facts[0], &replayed); err != nil {
		t.Fatal(err)
	}
	if got := replayed.DefinitionExtractors["prompt:writer"]; len(got) != 2 || got[1].Extension == nil {
		t.Fatalf("replayed extractor provenance = %+v", got)
	}
}

func TestDefinitionExtractorsFromEnvelopesUsesOnlyDurableDefinitionEvidence(t *testing.T) {
	fact, err := json.Marshal(store.ProjectDefinition{ID: "prompt:writer"})
	if err != nil {
		t.Fatal(err)
	}
	contributors := []projectindex.IndexFactExtractorProvenance{{Name: "prompt"}}
	got := definitionExtractorsFromEnvelopes([]projectindex.IndexFactEnvelope{
		{Kind: "definitions", Fact: fact, Provenance: projectindex.IndexFactProvenance{Extractors: contributors}},
		{Kind: "relations", Fact: fact, Provenance: projectindex.IndexFactProvenance{Extractors: contributors}},
	})
	if len(got) != 1 || len(got["prompt:writer"]) != 1 || got["prompt:writer"][0].Name != "prompt" {
		t.Fatalf("definition extractor cache projection = %+v", got)
	}
}
