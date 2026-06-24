package devtools

import "time"

const defaultProjectIndexReindexTimeout = 120 * time.Second

var projectIndexSemanticTimeout = 30 * time.Second
var projectIndexRuntimeTimeout = 30 * time.Second
var projectIndexLintTimeout = 30 * time.Second

var projectIndexSemanticBudget = IndexPatchBudget{
	MaxFiles:        5000,
	MaxDefinitions:  2500,
	MaxRelations:    10000,
	MaxSourceRefs:   20000,
	MaxDiagnostics:  250,
	MaxLintFindings: 1000,
	MaxSources:      10000,
	MaxBytes:        8 * 1024 * 1024,
}

var projectIndexRuntimeBudget = IndexPatchBudget{
	MaxDefinitions:  2500,
	MaxRelations:    10000,
	MaxSourceRefs:   20000,
	MaxDiagnostics:  250,
	MaxLintFindings: 1000,
	MaxBytes:        8 * 1024 * 1024,
}

var projectIndexLintBudget = IndexPatchBudget{
	MaxDiagnostics:  250,
	MaxLintFindings: 1000,
	MaxBytes:        4 * 1024 * 1024,
}
