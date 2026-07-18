package evalfs

import (
	"encoding/json"
	"fmt"
)

type runV3Contract struct {
	Status                *string                       `json:"status"`
	Passed                *bool                         `json:"passed"`
	Reasons               json.RawMessage               `json:"reasons"`
	SourceKey             *sourceKeyContract            `json:"sourceKey"`
	StartedAt             *float64                      `json:"startedAt"`
	EndedAt               *float64                      `json:"endedAt"`
	DefinitionFingerprint *string                       `json:"definitionFingerprint"`
	Selection             *selectionContract            `json:"selection"`
	CostControl           *string                       `json:"costControl"`
	BlockingVariants      *[]string                     `json:"blockingVariants"`
	Cells                 *[]cellContract               `json:"cells"`
	Variants              *[]variantContract            `json:"variants"`
	Aggregates            *map[string]aggregateContract `json:"aggregates"`
	Comparison            *comparisonContract           `json:"comparison"`
	Gates                 *gatesContract                `json:"gates"`
	Cost                  *costContract                 `json:"cost"`
	Provenance            *runProvenanceContract        `json:"provenance"`
}

type sourceKeyContract struct {
	RelativeFile *string `json:"relativeFile"`
	Export       *string `json:"export"`
}

type selectionContract struct {
	Cases      *[]string       `json:"cases"`
	Variants   *[]string       `json:"variants"`
	Trials     *int            `json:"trials"`
	CaseTrials *map[string]int `json:"caseTrials"`
	Filtered   *bool           `json:"filtered"`
}

type cellContract struct {
	CaseID              *string              `json:"caseId"`
	CaseName            *string              `json:"caseName"`
	Variant             *string              `json:"variant"`
	Trial               *int                 `json:"trial"`
	Status              *string              `json:"status"`
	SkipReason          *string              `json:"skipReason"`
	Task                *taskContract        `json:"task"`
	Scores              *[]scoreContract     `json:"scores"`
	Assertions          *assertionsContract  `json:"assertions"`
	Input               json.RawMessage      `json:"input"`
	Call                json.RawMessage      `json:"call"`
	Response            json.RawMessage      `json:"response"`
	UnvalidatedExpected *bool                `json:"unvalidatedExpected"`
	Error               *cellErrorContract   `json:"error"`
	Metrics             *cellMetricsContract `json:"metrics"`
	RunIDs              *[]string            `json:"runIds"`
	CapturedSignals     *[]string            `json:"capturedSignals"`
}

type taskContract struct {
	Status              *string `json:"status"`
	Reason              *string `json:"reason"`
	EvidenceFingerprint *string `json:"evidenceFingerprint"`
	EvidenceRef         *string `json:"evidenceRef"`
	FreshnessSource     *string `json:"freshnessSource"`
}

type scoreContract struct {
	Status              *string               `json:"status"`
	Reason              *string               `json:"reason"`
	Name                *string               `json:"name"`
	ContractFingerprint *string               `json:"contractFingerprint"`
	Value               json.RawMessage       `json:"value"`
	Label               *string               `json:"label"`
	Rationale           *string               `json:"rationale"`
	Message             *string               `json:"message"`
	Metrics             *scoreMetricsContract `json:"metrics"`
	Work                *scoreWorkContract    `json:"work"`
}

type scoreMetricsContract struct {
	ActualUSD *float64            `json:"actualUsd"`
	Usage     *tokenUsageContract `json:"usage"`
}

type tokenUsageContract struct {
	InputTokens        *int            `json:"inputTokens"`
	OutputTokens       *int            `json:"outputTokens"`
	TotalTokens        *int            `json:"totalTokens"`
	InputTokenDetails  *map[string]int `json:"inputTokenDetails"`
	OutputTokenDetails *map[string]int `json:"outputTokenDetails"`
}

type scoreWorkContract struct {
	Status      *string `json:"status"`
	Reason      *string `json:"reason"`
	EvidenceRef *string `json:"evidenceRef"`
	Reservation *string `json:"reservation"`
}

type assertionsContract struct {
	Ran          *int                        `json:"ran"`
	NotEvaluated *int                        `json:"notEvaluated"`
	Outcomes     *[]assertionOutcomeContract `json:"outcomes"`
}

type assertionOutcomeContract struct {
	ID      *string `json:"id"`
	Level   *string `json:"level"`
	Phase   *string `json:"phase"`
	Index   *int    `json:"index"`
	Status  *string `json:"status"`
	Matcher *string `json:"matcher"`
	Soft    *bool   `json:"soft"`
}

type cellErrorContract struct {
	Message *string `json:"message"`
	Phase   *string `json:"phase"`
}

type cellMetricsContract struct {
	DurationMS *float64 `json:"durationMs"`
	CostUSD    *float64 `json:"costUsd"`
}

type variantContract struct {
	Name         *string   `json:"name"`
	Fingerprint  *string   `json:"fingerprint"`
	OverrideKeys *[]string `json:"overrideKeys"`
	Blocking     *bool     `json:"blocking"`
}

type aggregateContract struct {
	Cells            *int                               `json:"cells"`
	Passed           *int                               `json:"passed"`
	Failed           *int                               `json:"failed"`
	Errored          *int                               `json:"errored"`
	Skipped          *int                               `json:"skipped"`
	PassRate         *float64                           `json:"passRate"`
	Scores           *map[string]aggregateScoreContract `json:"scores"`
	TrialConsistency *float64                           `json:"trialConsistency"`
	LatencyMS        *float64                           `json:"latencyMs"`
	KnownCostUSD     *float64                           `json:"knownCostUsd"`
}

type aggregateScoreContract struct {
	Mean *float64 `json:"mean"`
	SEM  *float64 `json:"sem"`
	N    *int     `json:"n"`
}

type gatesContract struct {
	Passed         *bool                 `json:"passed"`
	BlockingPassed *bool                 `json:"blockingPassed"`
	Results        *[]gateResultContract `json:"results"`
}

type gateResultContract struct {
	Gate          *string         `json:"gate"`
	VariantName   *string         `json:"variantName"`
	Threshold     json.RawMessage `json:"threshold"`
	Actual        json.RawMessage `json:"actual"`
	Passed        *bool           `json:"passed"`
	Informational *bool           `json:"informational"`
	Evidence      *string         `json:"evidence"`
	Reason        *string         `json:"reason"`
	Remediation   *string         `json:"remediation"`
}

type costContract struct {
	ActualUSD          *float64          `json:"actualUsd"`
	ReservedMaximumUSD *float64          `json:"reservedMaximumUsd"`
	UnknownActionCount *int              `json:"unknownActionCount"`
	Task               *costPartContract `json:"task"`
	Judge              *costPartContract `json:"judge"`
}

type costPartContract struct {
	ActualUSD *float64 `json:"actualUsd"`
}

type runProvenanceContract struct {
	Task          *string         `json:"task"`
	Host          *string         `json:"host"`
	EvidenceStore json.RawMessage `json:"evidenceStore"`
}

func validateRunV3(raw []byte) error {
	var value runV3Contract
	if err := decodeContract(raw, "run", &value); err != nil {
		return err
	}
	if value.SourceKey == nil || value.SourceKey.RelativeFile == nil || value.SourceKey.Export == nil || *value.SourceKey.Export != "default" {
		return contractError("sourceKey", "requires relativeFile and export=default")
	}
	if value.Status == nil || value.Passed == nil || !oneOf(*value.Status, "complete", "incomplete") {
		return contractError("status/passed", "is malformed")
	}
	if *value.Status == "incomplete" {
		if *value.Passed {
			return contractError("passed", "must be false for an incomplete run")
		}
		var reasons []string
		if len(value.Reasons) == 0 || json.Unmarshal(value.Reasons, &reasons) != nil || reasons == nil {
			return contractError("reasons", "is required for an incomplete run")
		}
		for index, reason := range reasons {
			if !oneOf(reason, "task_error", "assertion_error", "scorer_error", "baseline_missing", "baseline_evidence_incomplete", "score_missing", "score_null", "score_errored", "cost_missing") {
				return contractError(fmt.Sprintf("reasons[%d]", index), "is invalid")
			}
		}
	}
	if value.StartedAt == nil || value.EndedAt == nil || !validNonnegative(*value.StartedAt) || !validNonnegative(*value.EndedAt) {
		return contractError("startedAt/endedAt", "must be nonnegative numbers")
	}
	if value.DefinitionFingerprint == nil {
		return contractError("definitionFingerprint", "is required")
	}
	if err := validateSelection(value.Selection); err != nil {
		return err
	}
	if value.CostControl == nil || !oneOf(*value.CostControl, "not_required", "max_cost", "unknown") {
		return contractError("costControl", "is invalid")
	}
	if value.BlockingVariants == nil || value.Cells == nil || value.Variants == nil || value.Aggregates == nil {
		return contractError("cells/variants/aggregates", "are required")
	}
	for index := range *value.Cells {
		if err := validateCell((*value.Cells)[index], fmt.Sprintf("cells[%d]", index)); err != nil {
			return err
		}
	}
	for index, variant := range *value.Variants {
		if variant.Name == nil || variant.Fingerprint == nil || variant.OverrideKeys == nil || variant.Blocking == nil {
			return contractError(fmt.Sprintf("variants[%d]", index), "is malformed")
		}
	}
	for name, aggregate := range *value.Aggregates {
		if err := validateAggregate(aggregate, "aggregates."+name); err != nil {
			return err
		}
	}
	if value.Comparison != nil {
		if err := validateComparison(value.Comparison); err != nil {
			return err
		}
	}
	if err := validateGates(value.Gates); err != nil {
		return err
	}
	if err := validateCost(value.Cost); err != nil {
		return err
	}
	return validateRunProvenance(value.Provenance)
}

func validateSelection(value *selectionContract) error {
	if value == nil || value.Cases == nil || value.Variants == nil || value.Trials == nil || value.CaseTrials == nil || *value.Trials <= 0 {
		return contractError("selection", "is malformed")
	}
	if value.Filtered != nil && !*value.Filtered {
		return contractError("selection.filtered", "may only be true when present")
	}
	for _, trials := range *value.CaseTrials {
		if trials <= 0 {
			return contractError("selection.caseTrials", "values must be positive")
		}
	}
	return nil
}

func validateCell(cell cellContract, path string) error {
	if cell.CaseID == nil || cell.Variant == nil || cell.Trial == nil || *cell.Trial < 0 || cell.Status == nil || !oneOf(*cell.Status, "passed", "failed", "errored", "skipped") {
		return contractError(path, "identity or status is malformed")
	}
	if err := validateTask(cell.Task, path+".task"); err != nil {
		return err
	}
	if cell.Scores == nil {
		return contractError(path+".scores", "is required")
	}
	for index, score := range *cell.Scores {
		if err := validateScore(score, fmt.Sprintf("%s.scores[%d]", path, index)); err != nil {
			return err
		}
	}
	if err := validateAssertions(cell.Assertions, path+".assertions"); err != nil {
		return err
	}
	if len(cell.Input) == 0 || !rawObject(cell.Call) || !rawObject(cell.Response) {
		return contractError(path, "input/call/response is malformed")
	}
	if cell.UnvalidatedExpected != nil && !*cell.UnvalidatedExpected {
		return contractError(path+".unvalidatedExpected", "may only be true when present")
	}
	if cell.Error != nil && (cell.Error.Message == nil || cell.Error.Phase == nil || !oneOf(*cell.Error.Phase, "execute", "expect", "afterScores", "score")) {
		return contractError(path+".error", "is malformed")
	}
	if cell.Metrics == nil || cell.Metrics.DurationMS == nil || !validNonnegative(*cell.Metrics.DurationMS) || (cell.Metrics.CostUSD != nil && !validNonnegative(*cell.Metrics.CostUSD)) {
		return contractError(path+".metrics", "is malformed")
	}
	if cell.RunIDs == nil || cell.CapturedSignals == nil {
		return contractError(path+".runIds/capturedSignals", "are required")
	}
	return nil
}

func validateTask(task *taskContract, path string) error {
	if task == nil || task.Status == nil || task.Reason == nil {
		return contractError(path, "is malformed")
	}
	switch *task.Status {
	case "executed":
		if !oneOf(*task.Reason, "live_required", "fresh_requested", "performance_freshness", "no_exact_evidence", "identity_unavailable", "model_identity_unattested", "untracked_external_dependency", "nondeterministic_renderer", "task_binding_untracked", "unresolved_source_dependency", "implicit_media", "registry_identity_unavailable", "host_contract_unavailable") {
			return contractError(path, "has an invalid executed reason")
		}
	case "reused":
		if *task.Reason != "exact_evidence" || task.EvidenceFingerprint == nil || task.EvidenceRef == nil || task.FreshnessSource != nil {
			return contractError(path, "reused task requires exact evidence")
		}
	case "errored":
		if *task.Reason != "task_error" || task.EvidenceFingerprint != nil || task.EvidenceRef != nil || task.FreshnessSource != nil {
			return contractError(path, "errored task is malformed")
		}
	case "skipped":
		if *task.Reason != "source_skipped" || task.EvidenceFingerprint != nil || task.EvidenceRef != nil || task.FreshnessSource != nil {
			return contractError(path, "skipped task is malformed")
		}
	default:
		return contractError(path, "has an unknown status")
	}
	return nil
}

func validateScore(score scoreContract, path string) error {
	if score.Status == nil || score.Reason == nil || score.Name == nil || *score.Name == "" || score.ContractFingerprint == nil || *score.ContractFingerprint == "" {
		return contractError(path, "identity is malformed")
	}
	switch *score.Status {
	case "computed":
		if !rawNullableScore(score.Value) || score.Message != nil {
			return contractError(path, "computed score value is malformed")
		}
		if *score.Reason == "deterministic_local" {
			if score.Work != nil || score.Metrics != nil {
				return contractError(path, "deterministic score is malformed")
			}
			return nil
		}
		if *score.Reason != "managed_external_executed" || !validScoreMetrics(score.Metrics) || !validScoreWork(score.Work, "executed", "consumed", true, "fresh_requested", "performance_freshness", "no_exact_evidence", "identity_unavailable", "exact_evidence") {
			return contractError(path, "managed computed score is malformed")
		}
	case "reused":
		if *score.Reason != "managed_external_reused" || !rawNullableScore(score.Value) || score.Message != nil || score.Metrics != nil || !validScoreWork(score.Work, "reused", "released", true, "exact_evidence") {
			return contractError(path, "reused score is malformed")
		}
	case "missing":
		if *score.Reason != "dependency_failed" || len(score.Value) != 0 || score.Label != nil || score.Rationale != nil || score.Message == nil || score.Metrics != nil || !validScoreWork(score.Work, "not_called", "released", false, "dependency_failed") {
			return contractError(path, "missing score is malformed")
		}
	case "errored":
		if *score.Reason != "scorer_error" || len(score.Value) != 0 || score.Label != nil || score.Rationale != nil || score.Message == nil || score.Metrics != nil {
			return contractError(path, "errored score is malformed")
		}
		if score.Work == nil {
			return nil
		}
		if !validScoreWork(score.Work, "errored", "consumed", false, "scorer_error") && !validScoreWork(score.Work, "not_called", "released", false, "scorer_error") {
			return contractError(path, "managed errored score work is malformed")
		}
	default:
		return contractError(path, "has an unknown status")
	}
	return nil
}

func validScoreMetrics(metrics *scoreMetricsContract) bool {
	if metrics == nil {
		return true
	}
	if metrics.ActualUSD == nil && metrics.Usage == nil {
		return false
	}
	if metrics.ActualUSD != nil && !validNonnegative(*metrics.ActualUSD) {
		return false
	}
	if metrics.Usage == nil {
		return true
	}
	usage := metrics.Usage
	if usage.InputTokens == nil || *usage.InputTokens < 0 || usage.OutputTokens == nil || *usage.OutputTokens < 0 || usage.TotalTokens == nil || *usage.TotalTokens < 0 || usage.InputTokenDetails == nil || usage.OutputTokenDetails == nil {
		return false
	}
	for _, details := range []map[string]int{*usage.InputTokenDetails, *usage.OutputTokenDetails} {
		for _, value := range details {
			if value < 0 {
				return false
			}
		}
	}
	return true
}

func validScoreWork(work *scoreWorkContract, status, reservation string, allowEvidenceRef bool, reasons ...string) bool {
	return work != nil && work.Status != nil && *work.Status == status && work.Reason != nil && oneOf(*work.Reason, reasons...) && work.Reservation != nil && *work.Reservation == reservation && (allowEvidenceRef || work.EvidenceRef == nil)
}

func validateAssertions(value *assertionsContract, path string) error {
	if value == nil || value.Ran == nil || value.NotEvaluated == nil || *value.Ran < 0 || *value.NotEvaluated < 0 || value.Outcomes == nil {
		return contractError(path, "is malformed")
	}
	for index, outcome := range *value.Outcomes {
		if outcome.ID == nil || outcome.Level == nil || !oneOf(*outcome.Level, "eval", "case") || outcome.Phase == nil || !oneOf(*outcome.Phase, "expect", "afterScores") || outcome.Index == nil || *outcome.Index < 0 || outcome.Status == nil || !oneOf(*outcome.Status, "passed", "failed", "not-evaluated", "uncaptured") || outcome.Matcher == nil || outcome.Soft == nil {
			return contractError(fmt.Sprintf("%s.outcomes[%d]", path, index), "is malformed")
		}
	}
	return nil
}

func validateAggregate(value aggregateContract, path string) error {
	counts := []*int{value.Cells, value.Passed, value.Failed, value.Errored, value.Skipped}
	for _, count := range counts {
		if count == nil || *count < 0 {
			return contractError(path, "counts are malformed")
		}
	}
	if value.PassRate == nil || *value.PassRate < 0 || *value.PassRate > 1 || value.TrialConsistency == nil || *value.TrialConsistency < 0 || *value.TrialConsistency > 1 || value.LatencyMS == nil || !validNonnegative(*value.LatencyMS) || value.Scores == nil || (value.KnownCostUSD != nil && !validNonnegative(*value.KnownCostUSD)) {
		return contractError(path, "metrics are malformed")
	}
	for name, score := range *value.Scores {
		if score.Mean == nil || score.SEM == nil || !validNonnegative(*score.SEM) || score.N == nil || *score.N < 0 {
			return contractError(path+".scores."+name, "is malformed")
		}
	}
	return nil
}

func validateGates(value *gatesContract) error {
	if value == nil || value.Passed == nil || value.BlockingPassed == nil || value.Results == nil {
		return contractError("gates", "is malformed")
	}
	for index, result := range *value.Results {
		path := fmt.Sprintf("gates.results[%d]", index)
		if result.Gate == nil || result.VariantName == nil || !rawNumberOrBoolean(result.Threshold) || !rawNumberOrBoolean(result.Actual) || result.Passed == nil || (result.Informational != nil && !*result.Informational) || (result.Evidence != nil && !oneOf(*result.Evidence, "complete", "incomplete")) || (result.Reason != nil && !oneOf(*result.Reason, "baseline_missing", "baseline_evidence_incomplete", "score_missing", "score_null", "score_errored", "cost_missing")) {
			return contractError(path, "is malformed")
		}
	}
	return nil
}

func validateCost(value *costContract) error {
	if value == nil || value.ReservedMaximumUSD == nil || !validNonnegative(*value.ReservedMaximumUSD) || value.UnknownActionCount == nil || *value.UnknownActionCount < 0 || value.Task == nil || value.Judge == nil || (value.ActualUSD != nil && !validNonnegative(*value.ActualUSD)) || (value.Task.ActualUSD != nil && !validNonnegative(*value.Task.ActualUSD)) || (value.Judge.ActualUSD != nil && !validNonnegative(*value.Judge.ActualUSD)) {
		return contractError("cost", "is malformed")
	}
	return nil
}

func validateRunProvenance(value *runProvenanceContract) error {
	if value == nil || value.Task == nil || !oneOf(*value.Task, "managed", "opaque") || value.Host == nil || *value.Host != "injected" {
		return contractError("provenance", "is malformed")
	}
	var literal string
	if json.Unmarshal(value.EvidenceStore, &literal) == nil {
		if literal == "none" {
			return nil
		}
		return contractError("provenance.evidenceStore", "has an unknown literal")
	}
	var store struct {
		Identity    *string `json:"identity"`
		Consistency *string `json:"consistency"`
		Write       *string `json:"write"`
		WriteReason *string `json:"writeReason"`
	}
	if json.Unmarshal(value.EvidenceStore, &store) != nil || store.Identity == nil || store.Consistency == nil || !oneOf(*store.Consistency, "read_after_write", "eventual") || store.Write == nil || !oneOf(*store.Write, "written", "failed", "not_eligible", "not_attempted") || (store.WriteReason != nil && !oneOf(*store.WriteReason, "identity_unavailable", "model_identity_unattested", "untracked_external_dependency", "task_binding_untracked", "unresolved_source_dependency", "implicit_media", "capture_policy", "observed_identity_mismatch")) {
		return contractError("provenance.evidenceStore", "is malformed")
	}
	return nil
}
