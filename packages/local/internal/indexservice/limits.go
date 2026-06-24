package indexservice

import (
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

// DefaultProjectIndexReindexTimeout bounds source discovery when callers do not
// provide their own deadline.
const DefaultProjectIndexReindexTimeout = 120 * time.Second

// ProjectIndexSemanticTimeout bounds one semantic enrichment request.
var ProjectIndexSemanticTimeout = 30 * time.Second

// ProjectIndexRuntimeTimeout bounds one runtime-rich enrichment request.
var ProjectIndexRuntimeTimeout = 30 * time.Second

// ProjectIndexLintTimeout bounds one lint enrichment or prefetch request.
var ProjectIndexLintTimeout = 30 * time.Second

// ProjectIndexSemanticBudget is the default safety envelope for semantic facts.
var ProjectIndexSemanticBudget = projectindex.IndexPatchBudget{
	MaxFiles:        5000,
	MaxDefinitions:  2500,
	MaxRelations:    10000,
	MaxSourceRefs:   20000,
	MaxDiagnostics:  250,
	MaxLintFindings: 1000,
	MaxSources:      10000,
	MaxBytes:        8 * 1024 * 1024,
}

// ProjectIndexRuntimeBudget is the default safety envelope for runtime facts.
var ProjectIndexRuntimeBudget = projectindex.IndexPatchBudget{
	MaxDefinitions:  2500,
	MaxRelations:    10000,
	MaxSourceRefs:   20000,
	MaxDiagnostics:  250,
	MaxLintFindings: 1000,
	MaxBytes:        8 * 1024 * 1024,
}

// ProjectIndexLintBudget is the default safety envelope for lint findings.
var ProjectIndexLintBudget = projectindex.IndexPatchBudget{
	MaxDiagnostics:  250,
	MaxLintFindings: 1000,
	MaxBytes:        4 * 1024 * 1024,
}
