package store

import "time"

// DefaultCatalogIndexingStatus is the empty devtools catalog state before a
// source index has completed.
func DefaultCatalogIndexingStatus() *ProjectCatalogIndexingStatus {
	return &ProjectCatalogIndexingStatus{
		Status: "cold",
		AST: CatalogIndexingPhaseStatus{
			Status: "pending",
		},
		Semantic: CatalogIndexingSemanticStatus{
			Status: "disabled",
		},
		Cache: &CatalogIndexingCacheStatus{
			Status: "miss",
		},
	}
}

// ReadyCatalogIndexingStatus describes the current full-index worker path. The
// semantic phase is explicit but disabled until the background enrichment slice
// lands.
func ReadyCatalogIndexingStatus(indexedAt string, duration time.Duration, fileCount int, diagnosticCount int, degraded bool) *ProjectCatalogIndexingStatus {
	status := "ready"
	astStatus := "ready"
	if degraded {
		status = "degraded"
		astStatus = "degraded"
	}
	return &ProjectCatalogIndexingStatus{
		Status: status,
		AST: CatalogIndexingPhaseStatus{
			Status:          astStatus,
			IndexedAt:       indexedAt,
			DurationMs:      duration.Milliseconds(),
			FileCount:       fileCount,
			DiagnosticCount: diagnosticCount,
		},
		Semantic: CatalogIndexingSemanticStatus{
			Status: "disabled",
		},
		Cache: &CatalogIndexingCacheStatus{
			Status: "miss",
		},
	}
}

func CachedCatalogIndexingStatus(previous *ProjectCatalogIndexingStatus, indexedAt string, loadedAt time.Time) *ProjectCatalogIndexingStatus {
	ast := CatalogIndexingPhaseStatus{
		Status:    "ready",
		IndexedAt: indexedAt,
	}
	semantic := CatalogIndexingSemanticStatus{
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
	return &ProjectCatalogIndexingStatus{
		Status:   "cached",
		AST:      ast,
		Semantic: semantic,
		Cache: &CatalogIndexingCacheStatus{
			Status:        "stale",
			LoadedAt:      loadedAt.UTC().Format(time.RFC3339Nano),
			SnapshotAgeMs: snapshotAgeMs,
		},
	}
}

func CatalogIndexingWithSemanticReady(current *ProjectCatalogIndexingStatus, indexedAt string, duration time.Duration, diagnosticCount int, enrichedDefinitionCount int) *ProjectCatalogIndexingStatus {
	next := cloneCatalogIndexingStatus(current)
	if next.Status == "" || next.Status == "cold" || next.Status == "cached" || next.Status == "refreshing" {
		next.Status = "ready"
	}
	next.Semantic = CatalogIndexingSemanticStatus{
		Status:                  "ready",
		IndexedAt:               indexedAt,
		DurationMs:              duration.Milliseconds(),
		DiagnosticCount:         diagnosticCount,
		EnrichedDefinitionCount: enrichedDefinitionCount,
	}
	next.Error = ""
	return next
}

func CatalogIndexingWithSemanticDegraded(current *ProjectCatalogIndexingStatus, duration time.Duration, message string) *ProjectCatalogIndexingStatus {
	next := cloneCatalogIndexingStatus(current)
	next.Status = "degraded"
	next.Semantic = CatalogIndexingSemanticStatus{
		Status:     "degraded",
		DurationMs: duration.Milliseconds(),
	}
	next.Error = message
	return next
}

func FailedCatalogIndexingStatus(duration time.Duration, message string) *ProjectCatalogIndexingStatus {
	return &ProjectCatalogIndexingStatus{
		Status: "failed",
		AST: CatalogIndexingPhaseStatus{
			Status:     "failed",
			DurationMs: duration.Milliseconds(),
			Error:      message,
		},
		Semantic: CatalogIndexingSemanticStatus{
			Status: "disabled",
		},
		Cache: &CatalogIndexingCacheStatus{
			Status: "miss",
		},
		Error: message,
	}
}

func cloneCatalogIndexingStatus(current *ProjectCatalogIndexingStatus) *ProjectCatalogIndexingStatus {
	if current == nil {
		return DefaultCatalogIndexingStatus()
	}
	next := *current
	if current.Cache != nil {
		cache := *current.Cache
		next.Cache = &cache
	}
	return &next
}
