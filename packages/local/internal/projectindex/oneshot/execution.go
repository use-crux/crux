package oneshot

import "github.com/use-crux/crux/packages/local/internal/store"

// Execution is the stable, presentation-safe status of a one-shot refresh.
// It intentionally excludes timestamps, durations, and other volatile values.
type Execution struct {
	Status   string
	Static   string
	Semantic string
	Cache    string
}

func executionFromIndex(index store.IndexData) Execution {
	execution := Execution{
		Status:   "complete",
		Static:   "unknown",
		Semantic: "unknown",
	}
	if index.Indexing == nil {
		return execution
	}
	execution.Static = valueOrUnknown(index.Indexing.AST.Status)
	execution.Semantic = valueOrUnknown(index.Indexing.Semantic.Status)
	if index.Indexing.Cache != nil {
		execution.Cache = index.Indexing.Cache.Status
	}
	if index.Indexing.Status == "degraded" ||
		index.Indexing.AST.Status == "degraded" ||
		index.Indexing.Semantic.Status == "degraded" {
		execution.Status = "partial"
	}
	return execution
}

func valueOrUnknown(value string) string {
	if value == "" {
		return "unknown"
	}
	return value
}
