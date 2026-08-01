package planner

import (
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
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

func TestDefaultManifestIncludesImportQualifiedThread(t *testing.T) {
	if !contains(defaultCallNames, "thread") {
		t.Fatal("defaultCallNames missing thread")
	}
	if !contains(defaultCallInterestNames, "thread") {
		t.Fatal("defaultCallInterestNames missing thread")
	}

	var threadInterest *projectindex.StaticCallInterest
	for _, interest := range defaultCallInterests() {
		if interest.Name == "thread" {
			value := interest
			threadInterest = &value
			break
		}
	}
	if threadInterest == nil || !contains(threadInterest.ImportFrom, "@use-crux/core/thread") {
		t.Fatalf("thread interest = %+v, want @use-crux/core/thread", threadInterest)
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
	if !contains(names, "thread") {
		t.Fatal("default host extractors missing thread")
	}
}

func TestDefaultManifestIncludesImportQualifiedConnectedKnowledge(t *testing.T) {
	for _, name := range []string{"assertions", "communities", "knowledgeBase", "knowledgeModel", "relate", "relateEntities", "relateReferences", "view"} {
		if !contains(defaultCallNames, name) {
			t.Fatalf("defaultCallNames missing %q", name)
		}
		if !contains(defaultCallInterestNames, name) {
			t.Fatalf("defaultCallInterestNames missing %q", name)
		}
	}

	interests := map[string]projectindex.StaticCallInterest{}
	for _, interest := range defaultCallInterests() {
		interests[interest.Name] = interest
	}
	for _, name := range []string{"assertions", "communities", "knowledgeModel", "relate", "relateEntities", "relateReferences"} {
		interest := interests[name]
		if !contains(interest.ImportFrom, "@use-crux/core/knowledge") {
			t.Fatalf("%s interest = %+v, want @use-crux/core/knowledge", name, interest)
		}
	}
	knowledgeBase := interests["knowledgeBase"]
	for _, module := range []string{"@use-crux/core/knowledge", "@use-crux/core/retrieval", "@use-crux/core"} {
		if !contains(knowledgeBase.ImportFrom, module) {
			t.Fatalf("knowledgeBase interest = %+v, missing %s", knowledgeBase, module)
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
	if !contains(names, "knowledge") {
		t.Fatal("default host extractors missing knowledge")
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
