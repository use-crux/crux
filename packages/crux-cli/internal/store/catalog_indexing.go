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
