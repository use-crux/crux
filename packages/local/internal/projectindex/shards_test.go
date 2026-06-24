package projectindex

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestHasCompleteShardEvidenceAcceptsCoveredSources(t *testing.T) {
	index := store.IndexData{
		SourceGraph: &store.ProjectIndexSourceGraph{
			Capabilities: []string{"project-shards"},
			Shards:       []store.ProjectIndexShard{{ID: "src", Root: "src"}},
		},
		Sources: []store.IndexSourceFile{
			{File: "src/writer.ts"},
			{File: "src/nested/helper.ts"},
		},
	}

	if !HasCompleteShardEvidence(index) {
		t.Fatal("expected shard evidence to cover source files")
	}
}

func TestHasCompleteShardEvidenceRejectsUncoveredSources(t *testing.T) {
	index := store.IndexData{
		SourceGraph: &store.ProjectIndexSourceGraph{
			Capabilities: []string{"project-shards"},
			Shards:       []store.ProjectIndexShard{{ID: "src", Root: "src"}},
		},
		Sources: []store.IndexSourceFile{
			{File: "src/writer.ts"},
			{File: "tests/writer.test.ts"},
		},
	}

	if HasCompleteShardEvidence(index) {
		t.Fatal("expected missing shard coverage to reject source graph")
	}
}
