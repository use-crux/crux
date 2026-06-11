package store

import "time"

// DefaultIndexIndexingStatus is the empty devtools index state before a
// source index has completed.
func DefaultIndexIndexingStatus() *ProjectIndexingStatus {
	return &ProjectIndexingStatus{
		Status: "cold",
		AST: IndexIndexingPhaseStatus{
			Status: "pending",
		},
		Semantic: IndexIndexingSemanticStatus{
			Status: "disabled",
		},
		Cache: &IndexIndexingCacheStatus{
			Status: "miss",
		},
	}
}

// ReadyIndexIndexingStatus describes the current full-index worker path. The
// semantic phase is explicit but disabled until the background enrichment slice
// lands.
func ReadyIndexIndexingStatus(indexedAt string, duration time.Duration, fileCount int, diagnosticCount int, degraded bool) *ProjectIndexingStatus {
	status := "ready"
	astStatus := "ready"
	if degraded {
		status = "degraded"
		astStatus = "degraded"
	}
	return &ProjectIndexingStatus{
		Status: status,
		AST: IndexIndexingPhaseStatus{
			Status:          astStatus,
			IndexedAt:       indexedAt,
			DurationMs:      duration.Milliseconds(),
			FileCount:       fileCount,
			DiagnosticCount: diagnosticCount,
		},
		Semantic: IndexIndexingSemanticStatus{
			Status: "disabled",
		},
		Cache: &IndexIndexingCacheStatus{
			Status: "miss",
		},
	}
}

func CachedIndexIndexingStatus(previous *ProjectIndexingStatus, indexedAt string, loadedAt time.Time) *ProjectIndexingStatus {
	ast := IndexIndexingPhaseStatus{
		Status:    "ready",
		IndexedAt: indexedAt,
	}
	semantic := IndexIndexingSemanticStatus{
		Status: "disabled",
	}
	if previous != nil {
		ast = previous.AST
		semantic = previous.Semantic
	}
	if ast.Status == "" {
		ast.Status = "ready"
	}
	if ast.IndexedAt == "" {
		ast.IndexedAt = indexedAt
	}
	if semantic.Status == "" {
		semantic.Status = "disabled"
	}
	snapshotAgeMs := int64(0)
	if indexedAt != "" {
		if indexedAtTime, err := time.Parse(time.RFC3339Nano, indexedAt); err == nil {
			snapshotAgeMs = loadedAt.Sub(indexedAtTime).Milliseconds()
			if snapshotAgeMs < 0 {
				snapshotAgeMs = 0
			}
		}
	}
	return &ProjectIndexingStatus{
		Status:   "cached",
		AST:      ast,
		Semantic: semantic,
		Cache: &IndexIndexingCacheStatus{
			Status:        "stale",
			LoadedAt:      loadedAt.UTC().Format(time.RFC3339Nano),
			SnapshotAgeMs: snapshotAgeMs,
		},
	}
}

func IndexIndexingWithSemanticReady(current *ProjectIndexingStatus, indexedAt string, duration time.Duration, diagnosticCount int, enrichedDefinitionCount int) *ProjectIndexingStatus {
	next := cloneIndexIndexingStatus(current)
	if next.Status == "" || next.Status == "cold" || next.Status == "cached" || next.Status == "refreshing" {
		next.Status = "ready"
	}
	next.Semantic = IndexIndexingSemanticStatus{
		Status:                  "ready",
		IndexedAt:               indexedAt,
		DurationMs:              duration.Milliseconds(),
		DiagnosticCount:         diagnosticCount,
		EnrichedDefinitionCount: enrichedDefinitionCount,
	}
	next.Error = ""
	return next
}

func IndexIndexingWithSemanticDegraded(current *ProjectIndexingStatus, duration time.Duration, message string) *ProjectIndexingStatus {
	next := cloneIndexIndexingStatus(current)
	next.Status = "degraded"
	next.Semantic = IndexIndexingSemanticStatus{
		Status:     "degraded",
		DurationMs: duration.Milliseconds(),
	}
	next.Error = message
	return next
}

func FailedIndexIndexingStatus(duration time.Duration, message string) *ProjectIndexingStatus {
	return &ProjectIndexingStatus{
		Status: "failed",
		AST: IndexIndexingPhaseStatus{
			Status:     "failed",
			DurationMs: duration.Milliseconds(),
			Error:      message,
		},
		Semantic: IndexIndexingSemanticStatus{
			Status: "disabled",
		},
		Cache: &IndexIndexingCacheStatus{
			Status: "miss",
		},
		Error: message,
	}
}

func cloneIndexIndexingStatus(current *ProjectIndexingStatus) *ProjectIndexingStatus {
	if current == nil {
		return DefaultIndexIndexingStatus()
	}
	next := *current
	if current.Cache != nil {
		cache := *current.Cache
		next.Cache = &cache
	}
	return &next
}
