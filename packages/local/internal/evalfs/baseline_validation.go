package evalfs

import (
	"encoding/json"
	"fmt"
)

type baselineV3Contract struct {
	SourceKey   *sourceKeyContract          `json:"sourceKey"`
	PromotedAt  *float64                    `json:"promotedAt"`
	PromotedBy  *string                     `json:"promotedBy"`
	ToolVersion *string                     `json:"toolVersion"`
	Coverage    *[]baselineCoverageContract `json:"coverage"`
	Skipped     *[]baselineSkippedContract  `json:"skippedCases"`
	Provenance  *baselineProvenanceContract `json:"provenance"`
	Warnings    *[]baselineWarningContract  `json:"warnings"`
}

type baselineCoverageContract struct {
	CaseID              *string                            `json:"caseId"`
	InputFingerprint    *string                            `json:"inputFingerprint"`
	CallFingerprint     *string                            `json:"callFingerprint"`
	ExpectedFingerprint *string                            `json:"expectedFingerprint"`
	Trials              *[]int                             `json:"trials"`
	Outcomes            *[]baselineOutcomeContract         `json:"outcomes"`
	Metrics             *map[string]baselineMetricContract `json:"metrics"`
}

type baselineOutcomeContract struct {
	Trial  *int    `json:"trial"`
	Status *string `json:"status"`
}

type baselineMetricContract struct {
	ContractFingerprint *string                        `json:"contractFingerprint"`
	Aggregation         *string                        `json:"aggregation"`
	Values              *[]baselineMetricValueContract `json:"values"`
}

type baselineMetricValueContract struct {
	Trial *int            `json:"trial"`
	Value json.RawMessage `json:"value"`
	Label *string         `json:"label"`
}

type baselineSkippedContract struct {
	CaseID *string `json:"caseId"`
	Reason *string `json:"reason"`
}

type baselineProvenanceContract struct {
	DefinitionFingerprint *string `json:"definitionFingerprint"`
	TaskFingerprint       *string `json:"taskFingerprint"`
}

type baselineWarningContract struct {
	Code    *string `json:"code"`
	Message *string `json:"message"`
}

func validateBaselineV3(raw []byte) error {
	var value baselineV3Contract
	if err := decodeContract(raw, "Baseline", &value); err != nil {
		return err
	}
	if value.SourceKey == nil || value.SourceKey.RelativeFile == nil || value.SourceKey.Export == nil || *value.SourceKey.Export != "default" {
		return contractError("sourceKey", "requires relativeFile and export=default")
	}
	if value.PromotedAt == nil || !validNonnegative(*value.PromotedAt) {
		return contractError("promotedAt", "must be nonnegative")
	}
	if value.ToolVersion == nil || *value.ToolVersion == "" {
		return contractError("toolVersion", "is required")
	}
	if value.Coverage == nil {
		return contractError("coverage", "is required")
	}
	for index, coverage := range *value.Coverage {
		path := fmt.Sprintf("coverage[%d]", index)
		if coverage.CaseID == nil || coverage.InputFingerprint == nil || coverage.CallFingerprint == nil || coverage.ExpectedFingerprint == nil || coverage.Trials == nil || coverage.Metrics == nil {
			return contractError(path, "is malformed")
		}
		if coverage.Outcomes == nil {
			return contractError(path+".outcomes", "is required")
		}
		for _, trial := range *coverage.Trials {
			if trial < 0 {
				return contractError(path, "trials must be nonnegative")
			}
		}
		if len(*coverage.Outcomes) != len(*coverage.Trials) {
			return contractError(path+".outcomes", "must align exactly with trials")
		}
		for outcomeIndex, outcome := range *coverage.Outcomes {
			outcomePath := fmt.Sprintf("%s.outcomes[%d]", path, outcomeIndex)
			if outcome.Trial == nil || *outcome.Trial != (*coverage.Trials)[outcomeIndex] ||
				outcome.Status == nil || !oneOf(*outcome.Status, "passed", "failed", "timed_out") {
				return contractError(outcomePath, "is malformed")
			}
		}
		for name, metric := range *coverage.Metrics {
			metricPath := path + ".metrics." + name
			if metric.ContractFingerprint == nil || metric.Aggregation == nil || *metric.Aggregation != "arithmetic_mean_non_null_v1" || metric.Values == nil {
				return contractError(metricPath, "is malformed")
			}
			if len(*metric.Values) != len(*coverage.Trials) {
				return contractError(metricPath+".values", "must align exactly with trials")
			}
			for valueIndex, sample := range *metric.Values {
				if sample.Trial == nil || *sample.Trial != (*coverage.Trials)[valueIndex] || !rawNullableFiniteNumber(sample.Value) {
					return contractError(fmt.Sprintf("%s.values[%d]", metricPath, valueIndex), "is malformed")
				}
				if *(*coverage.Outcomes)[valueIndex].Status == "timed_out" && string(sample.Value) != "null" {
					return contractError(fmt.Sprintf("%s.values[%d].value", metricPath, valueIndex), "must be null for a timed-out trial")
				}
			}
		}
	}
	if value.Skipped != nil {
		for index, skipped := range *value.Skipped {
			if skipped.CaseID == nil || skipped.Reason == nil {
				return contractError(fmt.Sprintf("skippedCases[%d]", index), "is malformed")
			}
		}
	}
	if value.Provenance == nil || value.Provenance.DefinitionFingerprint == nil || value.Provenance.TaskFingerprint == nil {
		return contractError("provenance", "is malformed")
	}
	if value.Warnings != nil {
		for index, warning := range *value.Warnings {
			if warning.Code == nil || *warning.Code != "promoted_failing_run" || warning.Message == nil {
				return contractError(fmt.Sprintf("warnings[%d]", index), "is malformed")
			}
		}
	}
	return nil
}

func rawNullableFiniteNumber(raw json.RawMessage) bool {
	if string(raw) == "null" {
		return true
	}
	var value float64
	return json.Unmarshal(raw, &value) == nil
}
