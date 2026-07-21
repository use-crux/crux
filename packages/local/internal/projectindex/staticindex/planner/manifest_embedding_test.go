package planner

import (
	"encoding/json"
	"testing"
)

func TestDefaultManifestIncludesEmbeddingExtractors(t *testing.T) {
	for _, name := range []string{"embedding", "embed", "embedMany", "indexer", "index", "reindex", "indexDocuments", "indexChunks"} {
		if !contains(defaultCallNames, name) {
			t.Fatalf("defaultCallNames missing %q", name)
		}
		if !contains(defaultCallInterestNames, name) {
			t.Fatalf("defaultCallInterestNames missing %q", name)
		}
	}

	var host struct {
		Extractors []struct {
			Name string `json:"name"`
		} `json:"extractors"`
	}
	if err := json.Unmarshal(defaultHost(), &host); err != nil {
		t.Fatalf("decode default host: %v", err)
	}
	names := make([]string, 0, len(host.Extractors))
	for _, extractor := range host.Extractors {
		names = append(names, extractor.Name)
	}
	for _, name := range []string{"embedding", "embedding.call", "rag.indexer"} {
		if !contains(names, name) {
			t.Fatalf("default host extractors missing %q", name)
		}
	}
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
