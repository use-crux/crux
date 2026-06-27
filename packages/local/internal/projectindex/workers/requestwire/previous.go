package requestwire

import "github.com/use-crux/crux/packages/local/internal/store"

const (
	RequestKindStart               = "start"
	RequestKindDone                = "done"
	RequestKindPreviousDefinitions = "previousIndex:definitions"
	RequestKindPreviousSources     = "previousIndex:sources"
	RequestKindSourceProfileBatch  = "sourceProfile:batch"
	RequestKindSyntaxRecords       = "syntaxRecords"
)

func HasPreviousRows(index *store.IndexData) bool {
	return index != nil && (len(index.Definitions) > 0 || len(index.Sources) > 0)
}

func CompactPrevious(index *store.IndexData) *store.IndexData {
	if index == nil {
		return nil
	}
	compact := *index
	compact.Definitions = nil
	compact.Sources = nil
	return &compact
}

func DefinitionBatches(index *store.IndexData) [][]store.ProjectDefinition {
	if index == nil {
		return nil
	}
	return Chunk(index.Definitions, BatchSize)
}

func SourceBatches(index *store.IndexData) [][]store.IndexSourceFile {
	if index == nil {
		return nil
	}
	return Chunk(index.Sources, BatchSize)
}

func Chunk[T any](values []T, size int) [][]T {
	if len(values) == 0 {
		return nil
	}
	if size <= 0 {
		size = len(values)
	}
	batches := [][]T{}
	for offset := 0; offset < len(values); offset += size {
		end := offset + size
		if end > len(values) {
			end = len(values)
		}
		batches = append(batches, values[offset:end])
	}
	return batches
}
