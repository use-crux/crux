package model

import (
	"encoding/json"
	"fmt"
	"strings"
)

type indexPatchBudgetViolation struct {
	Metric string
	Actual int
	Limit  int
}

func ValidatePatchBudget(patch IndexPatch, budget IndexPatchBudget) error {
	violations := indexPatchBudgetViolations(patch, budget)
	if len(violations) == 0 {
		return nil
	}
	parts := make([]string, 0, len(violations))
	for _, violation := range violations {
		parts = append(parts, fmt.Sprintf("%s %d/%d", violation.Metric, violation.Actual, violation.Limit))
	}
	return fmt.Errorf("index %s patch exceeded budget: %s", patch.Phase, strings.Join(parts, ", "))
}

func indexPatchBudgetViolations(patch IndexPatch, budget IndexPatchBudget) []indexPatchBudgetViolation {
	violations := []indexPatchBudgetViolation{}
	violations = appendIndexPatchBudgetViolation(violations, "definitions", len(patch.Facts.Definitions), budget.MaxDefinitions)
	violations = appendIndexPatchBudgetViolation(violations, "relations", len(patch.Facts.Relations), budget.MaxRelations)
	violations = appendIndexPatchBudgetViolation(violations, "sourceRefs", len(patch.Facts.SourceRefs), budget.MaxSourceRefs)
	violations = appendIndexPatchBudgetViolation(violations, "diagnostics", len(patch.Facts.Diagnostics), budget.MaxDiagnostics)
	violations = appendIndexPatchBudgetViolation(violations, "lintFindings", len(patch.Facts.LintFindings), budget.MaxLintFindings)
	violations = appendIndexPatchBudgetViolation(violations, "sources", len(patch.Facts.Sources), budget.MaxSources)
	if budget.MaxBytes > 0 {
		if data, err := json.Marshal(patch); err == nil {
			violations = appendIndexPatchBudgetViolation(violations, "bytes", len(data), budget.MaxBytes)
		}
	}
	return violations
}

func appendIndexPatchBudgetViolation(violations []indexPatchBudgetViolation, metric string, actual int, limit int) []indexPatchBudgetViolation {
	if limit > 0 && actual > limit {
		return append(violations, indexPatchBudgetViolation{Metric: metric, Actual: actual, Limit: limit})
	}
	return violations
}
