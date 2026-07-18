package evalfs

import (
	"encoding/json"
	"fmt"
)

type comparisonContract struct {
	BaselineID     *string                   `json:"baselineId"`
	BaselineRunID  *string                   `json:"baselineRunId"`
	SelectedArm    *string                   `json:"selectedArm"`
	Cases          *[]comparisonCaseContract `json:"cases"`
	UnmatchedCases *unmatchedCasesContract   `json:"unmatchedCases"`
}

type comparisonCaseContract struct {
	CaseID  *string                     `json:"caseId"`
	Status  *string                     `json:"status"`
	Reason  *string                     `json:"reason"`
	Metrics *[]comparisonMetricContract `json:"metrics"`
}

type comparisonMetricContract struct {
	Name      *string         `json:"name"`
	Status    *string         `json:"status"`
	Baseline  json.RawMessage `json:"baseline"`
	Candidate json.RawMessage `json:"candidate"`
	Delta     json.RawMessage `json:"delta"`
	Reason    *string         `json:"reason"`
}

type unmatchedCasesContract struct {
	BaselineOnly  *[]string `json:"baselineOnly"`
	CandidateOnly *[]string `json:"candidateOnly"`
}

func validateComparison(value *comparisonContract) error {
	if value.BaselineID == nil || value.BaselineRunID == nil || value.SelectedArm == nil || value.Cases == nil || value.UnmatchedCases == nil || value.UnmatchedCases.BaselineOnly == nil || value.UnmatchedCases.CandidateOnly == nil {
		return contractError("comparison", "is malformed")
	}
	for caseIndex, comparedCase := range *value.Cases {
		path := fmt.Sprintf("comparison.cases[%d]", caseIndex)
		if comparedCase.CaseID == nil || comparedCase.Status == nil || !oneOf(*comparedCase.Status, "compatible", "missing", "incompatible") || comparedCase.Metrics == nil {
			return contractError(path, "is malformed")
		}
		for metricIndex, metric := range *comparedCase.Metrics {
			if err := validateComparisonMetric(metric, fmt.Sprintf("%s.metrics[%d]", path, metricIndex)); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateComparisonMetric(value comparisonMetricContract, path string) error {
	if value.Name == nil || value.Status == nil {
		return contractError(path, "is malformed")
	}
	switch *value.Status {
	case "compatible":
		if !rawNullableFiniteNumber(value.Baseline) || !rawNullableFiniteNumber(value.Candidate) || !rawNullableFiniteNumber(value.Delta) {
			return contractError(path, "compatible values are malformed")
		}
	case "missing", "incompatible":
		if value.Reason == nil {
			return contractError(path, "reason is required")
		}
	default:
		return contractError(path, "has an unknown status")
	}
	return nil
}
