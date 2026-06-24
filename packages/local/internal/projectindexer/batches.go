package projectindexer

import "github.com/use-crux/crux/packages/local/internal/store"

func projectDefinitionBatches(values []store.ProjectDefinition, batchSize int) [][]store.ProjectDefinition {
	batches := [][]store.ProjectDefinition{}
	for offset := 0; offset < len(values); offset += batchSize {
		end := offset + batchSize
		if end > len(values) {
			end = len(values)
		}
		batches = append(batches, values[offset:end])
	}
	return batches
}

func indexSourceFileBatches(values []store.IndexSourceFile, batchSize int) [][]store.IndexSourceFile {
	batches := [][]store.IndexSourceFile{}
	for offset := 0; offset < len(values); offset += batchSize {
		end := offset + batchSize
		if end > len(values) {
			end = len(values)
		}
		batches = append(batches, values[offset:end])
	}
	return batches
}
