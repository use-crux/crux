package requestwire

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestCompactPreviousKeepsMetadataAndRemovesRows(t *testing.T) {
	previous := &store.IndexData{
		SchemaVersion: 7,
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:one"},
		},
		Sources: []store.IndexSourceFile{
			{File: "src/one.ts"},
		},
	}

	compact := CompactPrevious(previous)

	if compact == nil {
		t.Fatal("compact previous = nil")
	}
	if compact.SchemaVersion != previous.SchemaVersion {
		t.Fatalf("schema version = %d, want %d", compact.SchemaVersion, previous.SchemaVersion)
	}
	if len(compact.Definitions) != 0 || len(compact.Sources) != 0 {
		t.Fatalf("compact rows definitions=%d sources=%d, want no rows", len(compact.Definitions), len(compact.Sources))
	}
	if len(previous.Definitions) != 1 || len(previous.Sources) != 1 {
		t.Fatalf("original previous was mutated: %+v", previous)
	}
}

func TestPreviousBatchesUseWireBatchSize(t *testing.T) {
	previous := &store.IndexData{
		Definitions: make([]store.ProjectDefinition, BatchSize+1),
		Sources:     make([]store.IndexSourceFile, BatchSize*2+1),
	}

	definitionBatches := DefinitionBatches(previous)
	sourceBatches := SourceBatches(previous)

	if len(definitionBatches) != 2 || len(definitionBatches[0]) != BatchSize || len(definitionBatches[1]) != 1 {
		t.Fatalf("definition batch sizes = %v, want %d and 1", batchLengths(definitionBatches), BatchSize)
	}
	if len(sourceBatches) != 3 || len(sourceBatches[0]) != BatchSize || len(sourceBatches[1]) != BatchSize || len(sourceBatches[2]) != 1 {
		t.Fatalf("source batch sizes = %v, want %d, %d, and 1", batchLengths(sourceBatches), BatchSize, BatchSize)
	}
}

func TestBatchSemanticRequestCompactsPreviousAndSourceProfile(t *testing.T) {
	profile := projectSemanticProfile(BatchSize + 1)
	req := Request{
		ProtocolVersion: ProtocolVersion,
		Method:          "indexProjectSemantic",
		Root:            "/repo",
		PreviousIndex: &store.IndexData{
			SchemaVersion: 3,
			Definitions:   []store.ProjectDefinition{{ID: "prompt:one"}},
		},
		SourceProfile: &profile,
	}

	events, err := Batch(req)

	if err != nil {
		t.Fatalf("Batch error = %v", err)
	}
	if len(events) != 5 {
		t.Fatalf("events = %d, want start, previous definitions, two source profile batches, done", len(events))
	}
	start := events[0].(Request)
	if start.RequestKind != RequestKindStart {
		t.Fatalf("start kind = %q, want %q", start.RequestKind, RequestKindStart)
	}
	if start.PreviousIndex == nil || len(start.PreviousIndex.Definitions) != 0 {
		t.Fatalf("start previous index = %+v, want compact previous index", start.PreviousIndex)
	}
	if start.SourceProfile == nil || len(start.SourceProfile.Files) != 0 {
		t.Fatalf("start source profile files = %d, want compact profile", len(start.SourceProfile.Files))
	}
	if events[1].(Request).RequestKind != RequestKindPreviousDefinitions {
		t.Fatalf("event 1 kind = %q, want previous definitions", events[1].(Request).RequestKind)
	}
	if events[2].(Request).RequestKind != RequestKindSourceProfileBatch || len(events[2].(Request).SourceProfileFiles) != BatchSize {
		t.Fatalf("event 2 = %+v, want full source profile batch", events[2])
	}
	if events[3].(Request).RequestKind != RequestKindSourceProfileBatch || len(events[3].(Request).SourceProfileFiles) != 1 {
		t.Fatalf("event 3 = %+v, want final source profile batch", events[3])
	}
	if events[4].(Request).RequestKind != RequestKindDone {
		t.Fatalf("done kind = %q, want %q", events[4].(Request).RequestKind, RequestKindDone)
	}
}

func TestBatchRuntimeRequestUsesSharedPreviousIndexBatches(t *testing.T) {
	events, err := Batch(Request{
		ProtocolVersion: ProtocolVersion,
		Method:          "indexProjectRuntime",
		Root:            "/repo",
		PreviousIndex: &store.IndexData{
			Sources: []store.IndexSourceFile{{File: "src/one.ts"}},
		},
	})

	if err != nil {
		t.Fatalf("Batch error = %v", err)
	}
	if len(events) != 3 {
		t.Fatalf("events = %d, want start, previous sources, done", len(events))
	}
	if events[1].(Request).RequestKind != RequestKindPreviousSources {
		t.Fatalf("event 1 kind = %q, want previous sources", events[1].(Request).RequestKind)
	}
}

func projectSemanticProfile(count int) projectindex.SemanticSourceProfile {
	files := make([]projectindex.SemanticSourceProfileFile, count)
	for index := range files {
		files[index] = projectindex.SemanticSourceProfileFile{File: "src/file.ts"}
	}
	return projectindex.SemanticSourceProfile{Files: files}
}

func batchLengths[T any](batches [][]T) []int {
	lengths := make([]int, len(batches))
	for index, batch := range batches {
		lengths[index] = len(batch)
	}
	return lengths
}
